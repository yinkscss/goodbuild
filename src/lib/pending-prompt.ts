import type { NetworkId } from "@/config/networks";

/**
 * A prompt typed while logged out. Saved to sessionStorage under `gb:pendingPrompt`
 * when Send is pressed, restored and auto-sent after sign-in (docs/AUTH.md, Flow 2 and 5).
 * Attachments are not persisted: files can't survive a storage round trip cheaply,
 * so the user re-attaches after sign-in (noted in the UI later, M2).
 */
export interface PendingPrompt {
  prompt: string;
  templateId: string | null;
  network: NetworkId;
  savedAt: number;
}

export const PENDING_PROMPT_KEY = "gb:pendingPrompt";
/** Drop stale prompts so an old tab doesn't fire a build days later. */
export const PENDING_PROMPT_TTL_MS = 60 * 60 * 1000;

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function savePendingPrompt(
  value: Omit<PendingPrompt, "savedAt">,
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(PENDING_PROMPT_KEY, JSON.stringify({ ...value, savedAt: now }));
    return true;
  } catch {
    return false;
  }
}

export function readPendingPrompt(
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): PendingPrompt | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_PROMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingPrompt>;
    if (typeof parsed.prompt !== "string" || !parsed.prompt.trim()) return null;
    if (typeof parsed.savedAt !== "number" || now - parsed.savedAt > PENDING_PROMPT_TTL_MS) {
      storage.removeItem(PENDING_PROMPT_KEY);
      return null;
    }
    return {
      prompt: parsed.prompt,
      templateId: typeof parsed.templateId === "string" ? parsed.templateId : null,
      network: parsed.network === "celo" ? "celo" : "celo-sepolia",
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
}

/** Read and remove in one step so a prompt is only ever auto-sent once. */
export function takePendingPrompt(
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): PendingPrompt | null {
  const value = readPendingPrompt(storage, now);
  if (value && storage) {
    try {
      storage.removeItem(PENDING_PROMPT_KEY);
    } catch {
      /* ignore */
    }
  }
  return value;
}
