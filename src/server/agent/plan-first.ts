import "server-only";

import { and, eq, ne } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { messages, projects, turnJobs } from "@/server/db/schema";
import { hasPlanHeadroom } from "@/server/credits/cap";
import { cleanAnswer } from "@/lib/plan";
import { AUTO_FIX_LEAD, FIX_PROMPT } from "@/lib/preview-errors";
import type { PlanAnswer, TurnRecord } from "@/lib/turn-types";

import { latestIntake } from "./plan-intake";

/**
 * Should this send plan first (D32)? Decided here on the server, so every way into a project gets
 * the same answer: the landing page and home both arrive as a queued first message.
 *
 * Yes while nothing has been planned or built. So "Try again" after a planning turn that failed
 * plans again, and a request the model only answered in words ("what can you build?") doesn't use
 * up the plan. No once a build has been asked for, so its "Try again" stays a build. No for fixes,
 * whatever state the project is in. No near the free AI cap (see hasPlanHeadroom).
 */
export async function shouldPlanFirst(db: Db, input: { projectId: string; userId: string; prompt?: string; skipPlan?: boolean }): Promise<boolean> {
  if (input.skipPlan) return false;
  const prompt = input.prompt?.trim() ?? "";
  if (prompt.startsWith(AUTO_FIX_LEAD) || prompt === FIX_PROMPT) return false;

  const [project] = await db.select({ currentVersion: projects.currentVersion }).from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project || project.currentVersion > 0) return false;

  const jobs = await db
    .select({ mode: turnJobs.mode, status: turnJobs.status })
    .from(turnJobs)
    .where(and(eq(turnJobs.projectId, input.projectId), ne(turnJobs.status, "cancelled")));
  if (jobs.some((j) => j.mode === "build" || j.status === "queued" || j.status === "running")) return false;

  const rows = await db.select({ role: messages.role, meta: messages.meta }).from(messages).where(eq(messages.projectId, input.projectId));
  if (latestIntake(rows)) return false;

  return hasPlanHeadroom(db, input.userId);
}

export type SaveAnswerResult = "saved" | "not_found" | "invalid";

/**
 * Save one answer on the assistant message that asked. No job and no model are involved, so
 * answering costs nothing and holds no worker, and a reload picks up where they were.
 */
export async function savePlanAnswer(db: Db, input: { projectId: string; messageId: string; questionId: string; answer: PlanAnswer }): Promise<SaveAnswerResult> {
  return db.transaction(async (tx) => {
    const [m] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.id, input.messageId), eq(messages.projectId, input.projectId), eq(messages.role, "assistant")))
      .for("update")
      .limit(1);
    const record = m?.meta as TurnRecord | null;
    const question = record?.intake?.questions.find((q) => q.id === input.questionId);
    if (!record?.intake || !question) return "not_found";
    const answer = cleanAnswer(question, input.answer);
    if (!answer) return "invalid";
    const next: TurnRecord = { ...record, intake: { ...record.intake, answers: { ...record.intake.answers, [question.id]: answer } } };
    await tx.update(messages).set({ meta: next as unknown as Record<string, unknown> }).where(eq(messages.id, m.id));
    return "saved";
  });
}
