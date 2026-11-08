"use client";

import * as React from "react";

import { useSendGate } from "@/components/auth/send-gate";
import { PromptBox, type PromptBoxHandle } from "@/components/prompt/prompt-box";
import { Button } from "@/components/ui/button";
import { getTemplate, type StarterTemplate } from "@/config/templates";
import { creditState, greetingFor } from "@/lib/home";
import { useMainnetAllowed } from "@/lib/use-mainnet-allowed";

/** Home chips (mockup b shows four; "Streaming G$ payroll" is swapped for a v1 template, Superfluid is post-MVP). */
export const HOME_CHIP_IDS = ["savings-circle", "tip-jar", "event-tickets", "crowdfund"] as const;
const chips = HOME_CHIP_IDS.map((id) => getTemplate(id)).filter((t): t is StarterTemplate => t !== undefined);

const PromptContext = React.createContext<React.RefObject<PromptBoxHandle | null> | null>(null);

/** Shares the home prompt box so the sidebar and empty state can fill or focus it. */
export function HomePromptProvider({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<PromptBoxHandle | null>(null);
  return <PromptContext.Provider value={ref}>{children}</PromptContext.Provider>;
}

function usePromptRef() {
  const ref = React.useContext(PromptContext);
  if (!ref) throw new Error("Wrap the home in <HomePromptProvider>.");
  return ref;
}

/** "Good morning" in the viewer's own time zone (the server doesn't know it). */
export function Greeting() {
  const [text, setText] = React.useState<string | null>(null);
  React.useEffect(() => {
    const update = () => setText(greetingFor(new Date()));
    const id = window.setTimeout(update, 0);
    const every = window.setInterval(update, 60_000);
    return () => {
      window.clearTimeout(id);
      window.clearInterval(every);
    };
  }, []);
  return <p className="eyebrow min-h-[15px]">{text ?? " "}</p>;
}

export function HomePrompt({ balanceGd }: { balanceGd: number | null }) {
  const ref = usePromptRef();
  const { send, sendError } = useSendGate();
  const state = creditState(balanceGd);
  const mainnetAllowed = useMainnetAllowed();
  return (
    <PromptBox
      ref={ref}
      chips={chips}
      chipsPlacement="below"
      hint={state === "preview" ? "$0.20 of AI free during the testnet beta" : undefined}
      creditsLabel={undefined}
      mainnetEnabled={mainnetAllowed}
      disabled={state === "empty"}
      disabledReason="Top up to keep building"
      onSubmit={send}
      status={sendError ? <span className="text-danger">{sendError}</span> : undefined}
      className="mt-8"
    />
  );
}

/** The sidebar card. It says what is true for this viewer now: the switch changes while the app runs (D50). */
export function NetworkNotice() {
  const mainnetAllowed = useMainnetAllowed();
  return (
    <div className="mt-4 rounded-card bg-surface p-4 shadow-card">
      <p className="text-xs font-semibold tracking-[.14em] text-violet uppercase">{mainnetAllowed ? "Celo mainnet is live" : "Testnet mode"}</p>
      <p className="mt-1.5 text-xs text-grey-600">
        {mainnetAllowed
          ? "Build and deploy on Celo mainnet with real money, or practise on Celo Sepolia with test money. Pick the network when you start a build. Contracts are unaudited, so start small."
          : "Deploys go to Celo Sepolia, which uses test money. Mainnet isn't open to your account yet."}
      </p>
    </div>
  );
}

/** "+ New build": focus the prompt box. */
export function NewBuildButton() {
  const ref = usePromptRef();
  return (
    <Button variant="primary" className="w-full" onClick={() => ref.current?.focus()}>
      + New build
    </Button>
  );
}

/** Chips in the empty state fill the prompt box above. */
export function FillPromptChip({ templateId }: { templateId: string }) {
  const ref = usePromptRef();
  const t = getTemplate(templateId);
  if (!t) return null;
  return (
    <Button size="chip" variant="chip" onClick={() => ref.current?.fill(t)}>
      {t.label}
    </Button>
  );
}
