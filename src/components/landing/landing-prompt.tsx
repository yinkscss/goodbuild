"use client";

import * as React from "react";

import { useSendGate } from "@/components/auth/send-gate";
import { PromptBox, type PromptBoxHandle } from "@/components/prompt/prompt-box";
import { LANDING_CHIP_IDS, getTemplate, type StarterTemplate } from "@/config/templates";
import { useMainnetAllowed } from "@/lib/use-mainnet-allowed";

const chips = LANDING_CHIP_IDS.map((id) => getTemplate(id)).filter((t) => t !== undefined);

const FILL_EVENT = "gb:fill-prompt";

/** Fill the landing prompt from a template elsewhere on the page and bring it into view. */
export function fillLandingPrompt(templateId: string) {
  window.dispatchEvent(new CustomEvent<string>(FILL_EVENT, { detail: templateId }));
}

/**
 * Landing prompt box. Typing is always allowed; Send goes through the gate, which
 * saves the prompt and opens the connect modal when logged out (AUTH.md Flow 2).
 */
export function LandingPrompt({ gameTemplates = [] }: { gameTemplates?: StarterTemplate[] }) {
  const { send, sendError } = useSendGate();
  const box = React.useRef<PromptBoxHandle>(null);
  const mainnetAllowed = useMainnetAllowed();

  React.useEffect(() => {
    const onFill = (e: Event) => {
      const template = getTemplate((e as CustomEvent<string>).detail);
      const selected = template ?? gameTemplates.find((item) => item.id === (e as CustomEvent<string>).detail);
      if (selected) box.current?.fill(selected);
    };
    window.addEventListener(FILL_EVENT, onFill);
    return () => window.removeEventListener(FILL_EVENT, onFill);
  }, [gameTemplates]);

  return (
    <PromptBox
      ref={box}
      chips={chips}
      gameTemplates={gameTemplates}
      hint="Free to start, no card needed"
      mainnetEnabled={mainnetAllowed}
      onSubmit={send}
      status={sendError ? <span className="text-danger">{sendError}</span> : undefined}
    />
  );
}
