"use client";

import { useSendGate } from "@/components/auth/send-gate";
import { PromptBox } from "@/components/prompt/prompt-box";
import { SAMPLE_CREDITS_LABEL } from "@/config/landing-stats";
import { isMainnetEnabled } from "@/config/networks";
import { LANDING_CHIP_IDS, getTemplate } from "@/config/templates";

const chips = LANDING_CHIP_IDS.map((id) => getTemplate(id)).filter((t) => t !== undefined);

/**
 * Landing prompt box. Typing is always allowed; Send goes through the gate, which
 * saves the prompt and opens the connect modal when logged out (AUTH.md Flow 2).
 */
export function LandingPrompt() {
  const { send, sendError } = useSendGate();
  return (
    <PromptBox
      chips={chips}
      creditsLabel={SAMPLE_CREDITS_LABEL}
      mainnetEnabled={isMainnetEnabled()}
      onSubmit={send}
      status={sendError ? <span className="text-danger">{sendError}</span> : undefined}
    />
  );
}
