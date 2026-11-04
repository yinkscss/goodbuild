import { describe, expect, it } from "vitest";
import {
  PENDING_PROMPT_KEY,
  PENDING_PROMPT_TTL_MS,
  readPendingPrompt,
  savePendingPrompt,
  takePendingPrompt,
} from "./pending-prompt";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

const value = { prompt: "A tip jar", templateId: "tip-jar", network: "celo-sepolia" as const };

describe("pending prompt", () => {
  it("round-trips through storage", () => {
    const s = memoryStorage();
    expect(savePendingPrompt(value, s, 1000)).toBe(true);
    expect(readPendingPrompt(s, 2000)).toEqual({ ...value, savedAt: 1000 });
  });

  it("take() returns the prompt once and clears it", () => {
    const s = memoryStorage();
    savePendingPrompt(value, s, 1000);
    expect(takePendingPrompt(s, 1001)?.prompt).toBe("A tip jar");
    expect(takePendingPrompt(s, 1002)).toBeNull();
  });

  it("expires stale prompts", () => {
    const s = memoryStorage();
    savePendingPrompt(value, s, 0);
    expect(readPendingPrompt(s, PENDING_PROMPT_TTL_MS + 1)).toBeNull();
    expect(s.map.has(PENDING_PROMPT_KEY)).toBe(false);
  });

  it("rejects corrupt or empty data", () => {
    const s = memoryStorage();
    s.setItem(PENDING_PROMPT_KEY, "{not json");
    expect(readPendingPrompt(s)).toBeNull();
    s.setItem(PENDING_PROMPT_KEY, JSON.stringify({ prompt: "  ", savedAt: Date.now() }));
    expect(readPendingPrompt(s)).toBeNull();
  });

  it("coerces unknown networks to Celo Sepolia", () => {
    const s = memoryStorage();
    s.setItem(PENDING_PROMPT_KEY, JSON.stringify({ prompt: "x", network: "alfajores", savedAt: 5 }));
    expect(readPendingPrompt(s, 6)?.network).toBe("celo-sepolia");
  });

  it("is a no-op without storage", () => {
    expect(savePendingPrompt(value, null)).toBe(false);
    expect(readPendingPrompt(null)).toBeNull();
  });
});
