import "server-only";

import { and, eq, ne } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects, turnJobs } from "@/server/db/schema";
import { firstIntent } from "@/lib/first-intent";
import type { TurnRecord } from "@/lib/turn-types";

/** Ready ideas, each a full request that builds as it is. G$ money apps first: most first prompts ask for one. */
export const APP_IDEAS = [
  "A G$ savings circle: up to 12 friends each put in the same amount of G$ every week, and each week one member collects the pot, in an order everyone can see. Show who has paid this round and whose turn is next.",
  "A G$ tip jar for my page: visitors connect their wallet, pick an amount of G$ and leave a short thank-you note. Show the total received and the latest tips.",
  "Event tickets paid in G$: I set the event name, date, price and number of seats, people buy a ticket with G$ and get a ticket code, and I can check codes at the door. Show how many seats are left.",
];
export const GAME_IDEAS = [
  "A tap-to-jump runner game with a monkey on a jungle path: dodge gaps and falling coconuts, collect bananas, a start screen, a game-over screen with Play again, and a best score.",
  "A word puzzle game: guess a five-letter word in six tries, with coloured hints after each guess, a keyboard on screen, and a daily streak.",
  "A two-player four-in-a-row game on one phone, with a computer opponent to play alone, a start menu and a winner screen with Play again.",
];
export const IDEAS_REPLY = "Here are three apps I can build for you right away. Pick one, or tell me your own idea in a sentence (what it does and who uses it).";

/**
 * A project's first message that asks what to build or names nothing to build (D175) gets three ready ideas,
 * with no job, no hold and no credits. Once per project: if they ask again, it plans or builds as usual.
 * Returns the saved user message id when it answered, or null when the send should go on as normal.
 */
export async function answerWithIdeas(db: Db, input: { projectId: string; text: string; userMessageId?: string }): Promise<string | null> {
  if (firstIntent(input.text) !== "ideas") return null;
  return db.transaction(async (raw) => {
    const tx = raw as unknown as Db;
    const [project] = await tx.select({ currentVersion: projects.currentVersion }).from(projects).where(eq(projects.id, input.projectId)).for("update");
    if (!project || project.currentVersion > 0) return null;
    const [job] = await tx.select({ id: turnJobs.id }).from(turnJobs).where(and(eq(turnJobs.projectId, input.projectId), ne(turnJobs.status, "cancelled"))).limit(1);
    if (job) return null;
    const replies = await tx.select({ meta: messages.meta }).from(messages).where(and(eq(messages.projectId, input.projectId), eq(messages.role, "assistant")));
    const shown = replies.find((m) => m.meta?.ideas === true);
    // The same message sent twice (two tabs, a reload): it was answered already, so don't plan or build it now.
    if (shown) return input.userMessageId && shown.meta?.ideasFor === input.userMessageId ? input.userMessageId : null;
    // now() is the same for both rows in one transaction: give the reply its own later time so it sorts after.
    const at = Date.now();
    let messageId = input.userMessageId;
    if (messageId) await tx.update(messages).set({ status: "done" }).where(and(eq(messages.id, messageId), eq(messages.projectId, input.projectId)));
    else [{ id: messageId }] = await tx.insert(messages).values({ projectId: input.projectId, role: "user", content: input.text, status: "done", meta: { mode: "build" }, createdAt: new Date(at) }).returning({ id: messages.id });
    const game = /\bgames?\b/i.test(input.text);
    const record: TurnRecord & { ideas: true; ideasFor: string } = { kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "answered", suggestions: game ? GAME_IDEAS : APP_IDEAS, ideas: true, ideasFor: messageId! };
    await tx.insert(messages).values({ projectId: input.projectId, role: "assistant", content: IDEAS_REPLY, status: "done", meta: record as unknown as Record<string, unknown>, createdAt: new Date(at + 1) });
    return messageId!;
  });
}
