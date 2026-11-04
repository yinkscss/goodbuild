"use client";

import * as React from "react";

import { PromptBox, type PromptSubmission } from "@/components/prompt/prompt-box";
import { SAMPLE_CREDITS_LABEL } from "@/config/landing-stats";
import { isMainnetEnabled } from "@/config/networks";
import { LANDING_CHIP_IDS, getTemplate } from "@/config/templates";
import { savePendingPrompt } from "@/lib/pending-prompt";

const chips = LANDING_CHIP_IDS.map((id) => getTemplate(id)).filter((t) => t !== undefined);

/**
 * Logged-out prompt box. Typing is always allowed; Send saves the prompt
 * (`gb:pendingPrompt`) so it survives sign-in. M2 opens the connect modal here.
 */
export function LandingPrompt() {
  const [saved, setSaved] = React.useState(false);

  function handleSubmit(s: PromptSubmission) {
    savePendingPrompt({ prompt: s.prompt, templateId: s.templateId, network: s.network });
    setSaved(true);
  }

  return (
    <PromptBox
      chips={chips}
      creditsLabel={SAMPLE_CREDITS_LABEL}
      mainnetEnabled={isMainnetEnabled()}
      onSubmit={handleSubmit}
      status={saved ? "Prompt saved. Sign in to send it (wallet sign-in lands in the next milestone)." : undefined}
    />
  );
}
