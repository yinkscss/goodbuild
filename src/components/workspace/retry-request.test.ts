import { describe, expect, it } from "vitest";

import { CONTINUE_PROMPT, FIX_PROMPT } from "@/lib/preview-errors";
import type { TurnRecord } from "@/lib/turn-types";

import { retryRequest } from "./chat-panel";

const record = (over: Partial<TurnRecord> = {}): TurnRecord => ({ kind: "turn", mode: "build", steps: [], log: [], changes: [], chargedMicro: 0, status: "needs_fix", jobId: "job-1", ...over });
const crash = "The preview shows this error in src/A.tsx:3. Fix it:\nTypeError\nx is undefined";

describe("what Fix it for me sends (D164)", () => {
  it("continues the failed build with the preview's crash", () => {
    expect(retryRequest(record(), crash)).toEqual({ kind: "job", jobId: "job-1", useCredits: false, note: crash });
  });

  it("after a credit top-up, runs on credits and still carries the crash", () => {
    expect(retryRequest(record(), crash, { afterTopUp: true })).toEqual({ kind: "job", jobId: "job-1", useCredits: true, note: crash });
  });

  it("continues a build paused for credits as it was, without the crash note", () => {
    expect(retryRequest(record({ paused: "credits" }), crash)).toEqual({ kind: "job", jobId: "job-1", useCredits: true });
    expect(retryRequest(record({ paused: "credits" }), crash, { afterTopUp: true })).toEqual({ kind: "job", jobId: "job-1", useCredits: true });
  });

  it("with no job to continue, sends a fix message that names the crash", () => {
    expect(retryRequest(record({ jobId: undefined }), crash)).toEqual({ kind: "prompt", prompt: `${FIX_PROMPT}\n\n${crash}`, action: "repair" });
    expect(retryRequest(record({ jobId: undefined }), undefined)).toEqual({ kind: "prompt", prompt: FIX_PROMPT, action: "repair" });
    expect(retryRequest(record({ jobId: undefined, paused: "credits" }), crash)).toEqual({ kind: "prompt", prompt: CONTINUE_PROMPT, action: "resume" });
  });
});
