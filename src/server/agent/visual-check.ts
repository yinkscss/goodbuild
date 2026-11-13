import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages } from "@/server/db/schema";
import type { TurnRecord, VisualCheck } from "@/lib/turn-types";
import { sniffType, visionImage } from "./assets";
import { TIER_FOR, type ModelClient } from "./model";
import { isGameRequest } from "./plan-intake";
import { recordUsage } from "./store";
import { decideDirectFunding } from "@/server/credits/cap";

const MAX_ISSUES = 4;

/**
 * A game is seen before Play (D93): obstacles, characters and a running score only exist once it runs,
 * so they must not be reported missing from this picture. Each false report costs the person a build.
 */
const GAME_NOTE = `
This is a game, captured on its start screen before anyone pressed Play. Obstacles, enemies, other cars or characters, power-ups and a score that counts up only appear while it runs: do NOT report them missing. Do report a game area that is empty, one flat colour or plain background with nothing drawn in it, and a start screen with no Play or Start button.`;

export function visualCheckPrompt(args: { width: number; request: string; game?: boolean }): string {
  return `This is a screenshot of a web app GoodBuild just generated, rendered ${args.width}px wide in the preview. The user asked for: "${args.request.slice(0, 400)}".
Check it like a QA tester, not a designer. List only concrete visible defects:
- a blank or nearly blank page, or an error message instead of the app;
- overlapping, cut-off or overflowing elements;
- text that is unreadable against its background;
- broken images (empty boxes, alt text showing) or icons missing;
- unstyled content (plain HTML look, default blue links, no spacing);
- something the user explicitly asked for that is clearly missing from this screen.
Ignore taste, copy style and placeholder data that is labelled as an example.${args.game ? GAME_NOTE : ""} A wallet "Connect" button and "Deploy the contract to go live" notices are expected.
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
  /** The screenshot: a PNG, or a JPEG for a page too big for one. */
  png: Uint8Array;
}): Promise<VisualCheck | null> {
  const mime = sniffType(args.png);
  if (mime !== "image/png" && mime !== "image/jpeg") throw new Error("not a png or jpeg");
  const rows = await db_messages(args.db, args.projectId);
  const turn = [...rows].reverse().find((m) => m.role === "assistant" && (m.meta as TurnRecord | null)?.version === args.version);
  if (!turn) return null;
  const request = rows.slice(0, rows.indexOf(turn)).reverse().find((m) => m.role === "user")?.content ?? "";
  // "Fix these" or "Start building" doesn't say it's a game: the project's first messages do.
  const game = isGameRequest(rows.filter((m) => m.role === "user").map((m) => m.content).join("\n"));
  const image = await visionImage(args.png, mime);
  let charged = 0;
  // Outside any turn, so who funds it is decided now (D48).
  const funding = await decideDirectFunding(args.db, args.userId);
  let parsed: ReturnType<typeof parseVisualCheck> = null;
  // One retry: a reply can still come back empty or not as JSON.
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    let text = "";
    let finishReason: string | null = null;
    for await (const ev of args.model.stream({
      tier: TIER_FOR.build,
      maxTokens: 500,
      messages: [{ role: "user", content: [{ type: "text", text: visualCheckPrompt({ width: args.width, request, game }) }, { type: "image", ...image }] }],
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
          funding,
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
