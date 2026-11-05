/**
 * Rolling conversation memory (P17). The last HISTORY_WINDOW messages go to the model
 * verbatim; older ones are folded, a few at a time, into a short summary plus an explicit
 * list of decisions and constraints the user set ("tips at least 5 G$", "brand colour
 * #0f766e", "no dark mode"). A plain prose summary is what loses those, so they are kept
 * as their own list. One cheap-model call per turn at most, only once the window is full.
 */

import { TIER_FOR, type ModelClient, type ModelEvent } from "./model";

export const HISTORY_WINDOW = 8;
const MAX_DECISIONS = 15;

export interface Memory {
  summary: string;
  decisions: string[];
  /** How many of the project's older messages (oldest first) are folded in. */
  upTo: number;
}

export interface MemoryMessage {
  role: "user" | "assistant";
  content: string;
}

export const EMPTY_MEMORY: Memory = { summary: "", decisions: [], upTo: 0 };

/**
 * Fold messages that have left the window into memory. `all` is every user/assistant message
 * with text, oldest first, excluding the current turn. Returns the same memory when nothing new
 * has left the window. Never throws: a failed call keeps a plain digest of the user's words.
 */
export async function updateMemory(
  model: ModelClient,
  memory: Memory | null,
  all: MemoryMessage[],
  onUsage: (ev: Extract<ModelEvent, { type: "usage" }>) => Promise<void> | void,
  /** For the build log: whether the model's reply was usable, and its output tokens. */
  onResult?: (r: { fallback: boolean; outputTokens: number; chars: number }) => void,
): Promise<Memory> {
  const current = memory ?? EMPTY_MEMORY;
  const older = all.slice(0, Math.max(0, all.length - HISTORY_WINDOW));
  if (older.length <= current.upTo) return current;
  // Turn numbers (1 = the first user message) so decisions keep when they were made.
  const turnOf: number[] = [];
  let turn = 0;
  for (const m of all) {
    if (m.role === "user") turn++;
    turnOf.push(Math.max(1, turn));
  }
  const fresh = older.slice(current.upTo);
  const freshTurns = turnOf.slice(current.upTo, older.length);
  let outputTokens = 0;
  let text = "";
  try {
    for await (const ev of model.stream({
      tier: TIER_FOR.build,
      maxTokens: 900,
      messages: [
        { role: "system", content: SUMMARISER },
        {
          role: "user",
          content: `Current memory:\n${JSON.stringify({ summary: current.summary, decisions: current.decisions })}\n\nNew messages, oldest first:\n${fresh
            .map((m, i) => `${m.role.toUpperCase()} (turn ${freshTurns[i]}): ${m.content.slice(0, 1500)}`)
            .join("\n\n")}`,
        },
      ],
    })) {
      if (ev.type === "text") text += ev.delta;
      else if (ev.type === "usage") {
        outputTokens += ev.outputTokens;
        await onUsage(ev);
      }
    }
    const parsed = parseMemory(text);
    if (parsed) {
      onResult?.({ fallback: false, outputTokens, chars: text.length });
      return { ...parsed, upTo: older.length };
    }
  } catch {
    /* fall through to the digest */
  }
  onResult?.({ fallback: true, outputTokens, chars: text.length });
  return { ...digest(current, fresh, freshTurns), upTo: older.length };
}

const SUMMARISER = `You maintain the memory of a conversation between a user and GoodBuild, an AI that builds dApps and websites. Merge the new messages into the current memory and reply with JSON only, no code fence:
{"summary": "...", "decisions": ["...", "..."]}
- summary: under 120 words. What the app is, what has been built and changed so far, in order. Plain sentences.
- decisions: every decision, requirement, constraint or preference the USER stated that still applies, one short line each, starting with the turn it was made in as [tN] (e.g. "[t1] Minimum tip is 20 G$"), keeping exact values (names, colours, amounts, limits, wording they asked for, things they said not to do). Keep earlier decisions and their [tN] unless the user reversed them; drop reversed ones. Not the assistant's ideas unless the user accepted them. At most ${MAX_DECISIONS}, in turn order.`;

export function parseMemory(text: string): Omit<Memory, "upTo"> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const j = JSON.parse(text.slice(start, end + 1)) as { summary?: unknown; decisions?: unknown };
    const summary = typeof j.summary === "string" ? j.summary.trim().slice(0, 1200) : "";
    const decisions = Array.isArray(j.decisions)
      ? j.decisions.map((d) => String(d ?? "").replace(/\s+/g, " ").trim().slice(0, 200)).filter(Boolean).slice(0, MAX_DECISIONS)
      : [];
    if (!summary && !decisions.length) return null;
    return { summary, decisions };
  } catch {
    return null;
  }
}

/** Fallback without a model: keep the user's own words, trimmed. */
function digest(current: Memory, fresh: MemoryMessage[], turns: number[]): Omit<Memory, "upTo"> {
  const asks = fresh.map((m, i) => ({ m, t: turns[i] })).filter((x) => x.m.role === "user").map((x) => `User asked (turn ${x.t}): ${x.m.content.replace(/\s+/g, " ").trim().slice(0, 160)}`);
  const summary = [current.summary, ...asks].filter(Boolean).join(" ").slice(-1200);
  return { summary, decisions: current.decisions };
}

/** The memory block for the context message. */
export function memoryBlock(memory: Memory | null): string {
  if (!memory || (!memory.summary && !memory.decisions.length)) return "";
  const decisions = memory.decisions.length
    ? `\nDecisions and constraints the user set earlier (still in force; follow them; [tN] is the turn, 1 = their first message):\n${memory.decisions.map((d) => `- ${d}`).join("\n")}`
    : "";
  return `Earlier in this conversation (older messages, summarised):\n${memory.summary}${decisions}`;
}
