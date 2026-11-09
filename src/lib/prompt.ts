/** Pure helpers behind the prompt box, kept separate so they can be unit tested. */

export const PROMPT_MIN_ROWS = 2;
export const PROMPT_MAX_ROWS = 8;
export const PROMPT_MAX_LENGTH = 4000;

/**
 * How many rows the textarea should show for its content height.
 * Auto-grows from 2 to 8 rows (DESIGN_SYSTEM §3), then scrolls.
 */
export function rowsForContent(
  scrollHeight: number,
  lineHeight: number,
  min = PROMPT_MIN_ROWS,
  max = PROMPT_MAX_ROWS,
): number {
  if (!Number.isFinite(scrollHeight) || !Number.isFinite(lineHeight) || lineHeight <= 0) return min;
  const rows = Math.ceil(scrollHeight / lineHeight - 0.01);
  return Math.min(max, Math.max(min, rows));
}

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
}

/** Enter submits (also Cmd/Ctrl+Enter). Shift+Enter adds a newline. Never while an IME is composing. */
export function isSubmitShortcut(e: KeyLike): boolean {
  if (e.isComposing) return false;
  return e.key === "Enter" && !e.shiftKey;
}

/** A prompt is sendable when it has non-whitespace text within the length cap. */
export function canSubmitPrompt(value: string, disabled = false): boolean {
  if (disabled) return false;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= PROMPT_MAX_LENGTH;
}

/** Normalise a prompt for sending: trim ends and collapse 3+ blank lines. */
export function normalisePrompt(value: string): string {
  return value.trim().replace(/\n{3,}/g, "\n\n");
}
