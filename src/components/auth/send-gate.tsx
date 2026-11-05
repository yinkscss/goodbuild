"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { ConnectModal } from "@/components/auth/connect-modal";
import type { PromptSubmission } from "@/components/prompt/prompt-box";
import { WorkspaceSkeleton } from "@/components/workspace/workspace-skeleton";
import { useAuth } from "@/lib/auth/context";
import { readPendingPrompt, savePendingPrompt, takePendingPrompt, type PendingPrompt } from "@/lib/pending-prompt";
import { ProjectRequestError, createProject } from "@/lib/projects-client";

interface SendGate {
  /** Send a prompt: straight through when signed in, otherwise save it and open the connect modal. */
  send: (submission: PromptSubmission) => Promise<void>;
  openConnect: () => void;
  /** A user-facing error from the last send, if any. */
  sendError: string | null;
}

const GateContext = React.createContext<SendGate | null>(null);

export function useSendGate(): SendGate {
  const ctx = React.useContext(GateContext);
  if (!ctx) throw new Error("useSendGate must be used inside <SendGateProvider>.");
  return ctx;
}

const SEND_ERROR_COPY: Record<string, string> = {
  region_blocked: "GoodBuild isn't available in your region.",
  invalid_body: "That prompt couldn't be sent. Try shortening it.",
};

/**
 * Prompt gating (AUTH.md Flow 2 and 5). Logged-out Send saves `gb:pendingPrompt`
 * and opens the connect modal over the page. After sign-in the saved prompt is
 * restored, a project is created with it, and the user lands in /p/[id]. They never retype.
 */
export function SendGateProvider({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [hasPending, setHasPending] = React.useState(false);
  const [sendError, setSendError] = React.useState<string | null>(null);
  const sendingRef = React.useRef(false);
  // From Send until the workspace has rendered, which can take seconds on a slow network.
  const [sentPrompt, setSentPrompt] = React.useState<string | null>(null);
  const [posting, setPosting] = React.useState(false);
  const [navigating, startNavigation] = React.useTransition();

  const deliver = React.useCallback(
    async (pending: Pick<PendingPrompt, "prompt" | "templateId" | "network">) => {
      if (sendingRef.current || navigating) return; // a repeat Send must not create a second project
      sendingRef.current = true;
      setSentPrompt(pending.prompt);
      setPosting(true);
      try {
        const project = await createProject({ prompt: pending.prompt, templateId: pending.templateId, network: pending.network });
        setSendError(null);
        setHasPending(false);
        startNavigation(() => router.push(`/p/${project.id}`));
      } catch (error) {
        if (error instanceof ProjectRequestError && error.status === 401) {
          // Session gone (expired or revoked): keep the prompt and ask to sign in again.
          savePendingPrompt(pending);
          setHasPending(true);
          setOpen(true);
        } else {
          savePendingPrompt(pending);
          const code = error instanceof ProjectRequestError ? error.code : "";
          setSendError(SEND_ERROR_COPY[code] ?? "We couldn't start that build. Your prompt is saved, try again.");
        }
      } finally {
        sendingRef.current = false;
        setPosting(false);
      }
    },
    [router, navigating],
  );

  const send = React.useCallback(
    async (s: PromptSubmission) => {
      const pending = { prompt: s.prompt, templateId: s.templateId, network: s.network };
      if (auth.user) return deliver(pending);
      savePendingPrompt(pending);
      setHasPending(true);
      setOpen(true);
    },
    [auth.user, deliver],
  );

  // After sign-in (or on load when already signed in), auto-send a saved prompt once.
  React.useEffect(() => {
    if (!auth.ready || !auth.user || sendingRef.current) return;
    if (!readPendingPrompt()) return;
    // Deferred so a re-run (Strict Mode, fast re-renders) cancels the first attempt
    // before it takes the prompt out of storage: it is sent exactly once.
    const timer = setTimeout(() => {
      const pending = takePendingPrompt();
      if (pending) void deliver(pending);
    }, 0);
    return () => clearTimeout(timer);
  }, [auth.ready, auth.user, deliver]);

  const value = React.useMemo<SendGate>(
    () => ({ send, openConnect: () => setOpen(true), sendError }),
    [send, sendError],
  );

  return (
    <GateContext.Provider value={value}>
      {children}
      {(posting || navigating) && sentPrompt && <WorkspaceSkeleton prompt={sentPrompt} className="fixed inset-0 z-50 bg-canvas" />}
      <ConnectModal open={open} onOpenChange={setOpen} hasPendingPrompt={hasPending} />
    </GateContext.Provider>
  );
}
