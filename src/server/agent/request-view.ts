import type { ChatMessage } from "./model";

/** File bodies longer than this, written before the current phase, are replaced with a note (D152). */
const KEEP_ARGS_CHARS = 300;
/** Tool results longer than this, from before the current phase, keep their head and tail. */
const KEEP_RESULT_CHARS = 6_000;
const HEAD_CHARS = 2_500;
const TAIL_CHARS = 1_500;

/**
 * What the model is sent (D152, after Codex's compaction): the conversation, with older work trimmed.
 * Before `boundary` (where the current phase began), the bodies of create_file and edit_file calls become a
 * note that says where the text is now, and long tool results keep only their head and tail. Everything
 * from the boundary on is sent as it is. The project's files are the source of truth, and read_file gets
 * them, so the model loses nothing it needs, and stops re-reading stale copies of files it has since changed.
 *
 * Pure and deterministic: the conversation itself is never changed, so a resumed turn's saved calls still
 * line up, and the trimmed prefix stays byte-identical for a whole phase, so the prompt cache keeps hitting.
 */
export function requestView(convo: ChatMessage[], boundary: number): ChatMessage[] {
  if (boundary <= 0) return convo;
  return convo.map((m, i) => {
    if (i >= boundary) return m;
    if (m.role === "assistant" && m.tool_calls?.length) {
      let changed = false;
      const tool_calls = m.tool_calls.map((c) => {
        const trimmed = trimArgs(c.function.name, c.function.arguments);
        if (trimmed === c.function.arguments) return c;
        changed = true;
        return { ...c, function: { ...c.function, arguments: trimmed } };
      });
      return changed ? { ...m, tool_calls } : m;
    }
    if (m.role === "tool" && m.content.length > KEEP_RESULT_CHARS) {
      const cut = m.content.length - HEAD_CHARS - TAIL_CHARS;
      return { ...m, content: `${m.content.slice(0, HEAD_CHARS)}\n[... ${cut} characters cut from this earlier result ...]\n${m.content.slice(-TAIL_CHARS)}` };
    }
    return m;
  });
}

function trimArgs(name: string, raw: string): string {
  if ((name !== "create_file" && name !== "edit_file") || raw.length <= KEEP_ARGS_CHARS) return raw;
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return raw;
  }
  const path = typeof args.path === "string" ? args.path : "the file";
  if (name === "create_file" && typeof args.content === "string") {
    const lines = args.content.split("\n").length;
    return JSON.stringify({ path: args.path, content: `[${lines} lines written to ${path} earlier in this turn; read_file ${path} for its current text]` });
  }
  if (name === "edit_file" && Array.isArray(args.edits)) {
    return JSON.stringify({ path: args.path, edits: [{ search: `[${args.edits.length} earlier edit${args.edits.length === 1 ? "" : "s"}]`, replace: `[applied earlier in this turn; read_file ${path} for its current text]` }] });
  }
  return raw;
}
