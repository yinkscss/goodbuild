"use client";

import * as React from "react";

/** Mirrors src/server/hackathon/claim.ts (server-only). The server decides what is actually paid. */
export const START_CREDITS = 20;
export const DEPLOY_CREDITS = 30;

export interface ClaimStatus {
  registered: boolean;
  startCredits: number;
  deployCredits: number;
  deployPending: boolean;
}

const EMPTY: ClaimStatus = { registered: false, startCredits: 0, deployCredits: 0, deployPending: false };
const FAILED = "We couldn't register you. Try again.";

/**
 * The signed-in person's hackathon status from /api/hackathon, and `run`, which registers them or
 * collects whatever is due (the deploy part). `onNewCredits` fires when a call added credits.
 */
export function useHackathonClaim(userId: string | null, onNewCredits: () => void) {
  const [status, setStatus] = React.useState<ClaimStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const total = React.useRef(0);

  React.useEffect(() => {
    if (!userId) return;
    let stopped = false;
    void fetch("/api/hackathon", { cache: "no-store" })
      .then(async (res) => (res.ok ? ((await res.json()) as ClaimStatus) : EMPTY))
      .catch(() => EMPTY)
      .then((s) => {
        if (stopped) return;
        total.current = s.startCredits + s.deployCredits;
        setStatus(s);
      });
    return () => {
      stopped = true;
    };
  }, [userId]);

  const run = React.useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/hackathon", { method: "POST" });
      const body = (await res.json().catch(() => ({}))) as Partial<ClaimStatus> & { message?: string };
      if (!res.ok) throw new Error(body.message ?? FAILED);
      const next = { ...EMPTY, ...body } as ClaimStatus;
      const after = next.startCredits + next.deployCredits;
      if (after > total.current) onNewCredits();
      total.current = after;
      setStatus(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : FAILED);
    } finally {
      setBusy(false);
    }
  }, [onNewCredits]);

  return { status, busy, error, run };
}
