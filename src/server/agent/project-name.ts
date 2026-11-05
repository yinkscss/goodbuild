import "server-only";

import { and, eq, ne } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { projects } from "@/server/db/schema";
import { TIER_FOR, type ModelClient } from "./model";
import { recordUsage } from "./store";

const NAMER = `You name apps. Given what someone asked to build, reply with a short, specific name for it: 2 to 4 words, Title Case, no quotes, no punctuation except the $ in "G$", and no generic words like App, dApp or Project. Say what makes this one different. Reply with the name and nothing else.`;

const MAX_LENGTH = 40;

/** A model's reply as a project name, or null if it isn't one. The prompt is user text, so this is strict. */
export function cleanName(reply: string): string | null {
  const name = reply.trim().replace(/^["'`*\s]+|["'`*.\s]+$/g, "").replace(/\s+/g, " ");
  if (name.length < 3 || name.length > MAX_LENGTH || name.split(" ").length > 5) return null;
  return /^[\p{L}\p{N}][\p{L}\p{N}$ '&-]*$/u.test(name) ? name : null;
}

/** Another of the owner's projects may already have this name, so number the new one. */
export function uniqueName(name: string, taken: string[]): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name} ${n}`.toLowerCase())) return `${name} ${n}`;
}

/**
 * Give a new project its own name, from a cheap call with no thinking. Best effort: it runs beside
 * the first build, and on any failure the name made from the prompt stays. The call counts as usage.
 */
export async function nameProject(db: Db, model: ModelClient, input: { projectId: string; userId: string; prompt: string; messageId?: string | null }): Promise<string | null> {
  const [project] = await db.select({ name: projects.name, ownerId: projects.ownerId }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) return null;

  let text = "";
  for await (const ev of model.stream({
    tier: TIER_FOR.build,
    maxTokens: 40,
    messages: [
      { role: "system", content: NAMER },
      { role: "user", content: input.prompt.slice(0, 1000) },
    ],
  })) {
    if (ev.type === "text") text += ev.delta;
    else if (ev.type === "usage") {
      await recordUsage(db, {
        userId: input.userId,
        projectId: input.projectId,
        messageId: input.messageId ?? null,
        callId: ev.callId || `${input.projectId}:name`,
        model: ev.model,
        inputTokens: ev.inputTokens,
        outputTokens: ev.outputTokens,
        cachedInputTokens: ev.cachedInputTokens,
      });
    }
  }

  const cleaned = cleanName(text);
  if (!cleaned) return null;
  const others = await db.select({ name: projects.name }).from(projects).where(and(eq(projects.ownerId, project.ownerId), ne(projects.id, input.projectId)));
  const name = uniqueName(cleaned, others.map((o) => o.name));
  // Only if it still has the name this started from.
  await db.update(projects).set({ name }).where(and(eq(projects.id, input.projectId), eq(projects.name, project.name)));
  return name;
}
