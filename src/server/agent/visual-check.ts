import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages } from "@/server/db/schema";
import type { TurnRecord, VisualCheck } from "@/lib/turn-types";
import { sniffType, visionImage } from "./assets";
import { TIER_FOR, type ModelClient } from "./model";
import { recordUsage } from "./store";

const MAX_ISSUES = 4;

export function visualCheckPrompt(args: { width: number; request: string }): string {
  return `This is a screenshot of a web app GoodBuild just generated, rendered ${args.width}px wide in the preview. The user asked for: "${args.request.slice(0, 400)}".
Check it like a QA tester, not a designer. List only concrete visible defects:
- a blank or nearly blank page, or an error message instead of the app;
- overlapping, cut-off or overflowing elements;
- text that is unreadable against its background;
- broken images (empty boxes, alt text showing) or icons missing;
- unstyled content (plain HTML look, default blue links, no spacing);
- something the user explicitly asked for that is clearly missing from this screen.
Ignore taste, copy style and placeholder data that is labelled as an example. A wallet "Connect" button and "Deploy the contract to go live" notices are expected.
Reply with JSON only, no code fence: {"ok": true} when nothing is wrong, or {"ok": false, "issues": ["short, specific defect and where it is", ...]} with at most ${MAX_ISSUES} issues.`;
}

export function parseVisualCheck(text: string): { ok: boolean; issues: string[] } | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as { ok?: unknown; issues?: unknown };
    const issues = Array.isArray(j.issues) ? j.issues.map((s) => String(s ?? "").replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, MAX_ISSUES) : [];
    if (typeof j.ok !== "boolean") return null;
    return { ok: j.ok && issues.length === 0, issues: j.ok ? [] : issues };
  } catch {
    return null;
  }
}

/**
 * The visual check (P17): the workspace captures the preview right after a build and sends the
 * PNG here; the cheap model (which reads images) lists visible defects, and the result is saved
 * on the turn that built that version so it survives a reload. It never edits files: the user
 * decides whether to send "Fix these".
 */
export async function runVisualCheck(args: {
  db: Db;
  model: ModelClient;
  projectId: string;
  userId: string;
  version: number;
  width: number;
  png: Uint8Array;
}): Promise<VisualCheck | null> {
  if (sniffType(args.png) !== "image/png") throw new Error("not a png");
  const rows = await db_messages(args.db, args.projectId);
  const turn = [...rows].reverse().find((m) => m.role === "assistant" && (m.meta as TurnRecord | null)?.version === args.version);
  if (!turn) return null;
  const request = rows.slice(0, rows.indexOf(turn)).reverse().find((m) => m.role === "user")?.content ?? "";
  const image = await visionImage(args.png, "image/png");
  let charged = 0;
  let parsed: ReturnType<typeof parseVisualCheck> = null;
  // One retry: a reply can still come back empty or not as JSON.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    let text = "";
    let finishReason: string | null = null;
    for await (const ev of args.model.stream({
      tier: TIER_FOR.build,
      maxTokens: 500,
      messages: [{ role: "user", content: [{ type: "text", text: visualCheckPrompt({ width: args.width, request }) }, { type: "image", ...image }] }],
    })) {
      if (ev.type === "text") text += ev.delta;
      else if (ev.type === "done") finishReason = ev.finishReason;
      else if (ev.type === "usage") {
        const cost = await recordUsage(args.db, {
          userId: args.userId,
          projectId: args.projectId,
          messageId: turn.id,
          callId: ev.callId || `visual:${crypto.randomUUID()}`,
          model: ev.model,
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cachedInputTokens: ev.cachedInputTokens,
        });
        charged += cost.chargedMicro;
      }
    }
    parsed = parseVisualCheck(text);
    if (!parsed) console.warn(`[visual-check] unusable reply for v${args.version}: finish=${finishReason} chars=${text.length}`);
  }
  if (!parsed) return null;
  const check: VisualCheck = { ...parsed, width: args.width, chargedMicro: charged };
  const meta = turn.meta as unknown as TurnRecord;
  await args.db
    .update(messages)
    .set({ meta: { ...meta, visualCheck: check, chargedMicro: meta.chargedMicro + charged } as unknown as Record<string, unknown> })
    .where(and(eq(messages.id, turn.id), eq(messages.projectId, args.projectId)));
  return check;
}

function db_messages(db: Db, projectId: string) {
  return db.select().from(messages).where(eq(messages.projectId, projectId)).orderBy(asc(messages.createdAt));
}
