"use client";
import * as React from "react";
import { useAuth } from "@/lib/auth/context";
import { useSendGate } from "@/components/auth/send-gate";
import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { allocateHackathonRewards } from "@/lib/hackathon-rewards";
import { MAX_APPROVALS_PER_PERSON, type VoteStatus } from "@/lib/hackathon-vote";
import { FlowstateVote } from "./flowstate-vote";

type Entry = { id: string; alias: string; title: string; pitch: string; liveUrl: string; sourceUrl: string; approvals: number };

const PENDING_KEY = "gb:hk-vote:pending";
const EMPTY: VoteStatus = { max: MAX_APPROVALS_PER_PERSON, used: 0, entryIds: [], signedIn: false, verified: false, voted: false };

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING_KEY);
  } catch {
    return null;
  }
}
function writePending(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PENDING_KEY, id);
    else sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage blocked: the pop-up just doesn't reopen after the GoodDollar trip.
  }
}

/**
 * Projects people can approve, with the three-approvals rule (D155). Used on the public /hackathon page
 * and in the app's Vote tab. Someone who hasn't finished the steps (email, GoodDollar, FlowState) gets
 * a small pop-up with the steps, then one click to approve. The project they picked is remembered
 * across the GoodDollar trip.
 */
export function VoteList() {
  const { user, ready } = useAuth();
  const { openConnect } = useSendGate();
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [status, setStatus] = React.useState<VoteStatus>(EMPTY);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");

  const loadEntries = React.useCallback(async () => {
    try {
      const res = await fetch("/api/hackathon/projects", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setEntries((await res.json()) as Entry[]);
    } catch {
      setError("The projects couldn’t load. Reload to try again.");
    }
  }, []);
  const loadStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/hackathon/votes", { cache: "no-store" });
      setStatus(res.ok ? ((await res.json()) as VoteStatus) : EMPTY);
    } catch {
      setStatus(EMPTY);
    }
  }, []);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data after mount
    void loadEntries();
  }, [loadEntries]);
  React.useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data after mount
    void loadStatus();
    // Back from GoodDollar: bring the pop-up back on the project they picked.
    const pending = readPending();
    if (pending && user) setPicked(pending);
  }, [ready, user, loadStatus]);

  // Published projects first by rank, then ideas that have no live app yet (they can't be approved).
  const ladder = entries ? allocateHackathonRewards(entries).map((entry) => ({ entry })) : [];
  const ready_ = status.signedIn && status.verified && status.voted;
  const left = status.max - status.used;

  async function approve(id: string) {
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/hackathon/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entryId: id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? "We couldn’t save that approval. Please try again.");
      setNotice("Approval saved. Thank you for backing this builder.");
      await Promise.all([loadEntries(), loadStatus()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
      writePending(null);
      setPicked(null);
    }
  }

  function choose(id: string) {
    setError("");
    setNotice("");
    if (ready_) {
      void approve(id);
      return;
    }
    writePending(id);
    setPicked(id);
  }

  if (!entries) return <p role="status" className="text-sm text-grey-600">{error || "Loading projects…"}</p>;
  const pickedEntry = ladder.find((r) => r.entry.id === picked)?.entry ?? null;

  return (
    <div>
      <div className="rounded-block bg-tint p-4 text-sm">
        <p className="font-semibold">
          {status.signedIn && status.verified
            ? `${status.used} of ${status.max} approvals used`
            : `Each verified person gets ${status.max} approvals`}
        </p>
        <p className="mt-1 text-grey-600">
          Approvals are free. Pick the {status.max} projects you’d actually use. Voting closes at the end of 10 Dec.
        </p>
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="mt-3 text-sm text-violet">{notice}</p>}
      {ladder.length === 0 ? (
        <p className="mt-4 text-sm text-grey-600">No projects yet. The first idea or app to be added shows up here.</p>
      ) : (
        <ul className="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
          {ladder.map(({ entry }) => {
            const mine = status.entryIds.includes(entry.id);
            const out = !mine && status.verified && left <= 0;
            return (
              <li key={entry.id} id={entry.id} className="flex flex-col gap-3 rounded-card bg-surface p-5 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <small className="text-grey-600">{entry.rank ? `#${entry.rank}` : "Idea"} · by {entry.alias}</small>
                  <strong className="whitespace-nowrap text-sm">
                    {entry.approvals} {entry.approvals === 1 ? "approval" : "approvals"}
                  </strong>
                </div>
                <div>
                  <h3 className="text-lg font-semibold">{entry.title}</h3>
                  <p className="mt-1 text-sm text-grey-600">{entry.pitch}</p>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {entry.liveUrl ? (
                    <a className="font-medium text-violet underline-offset-4 hover:underline" href={entry.liveUrl} target="_blank" rel="noreferrer">
                      Try the app ↗
                    </a>
                  ) : (
                    <span className="text-grey-600">Building soon</span>
                  )}
                  {entry.sourceUrl && (
                    <a className="font-medium text-violet underline-offset-4 hover:underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                      Source code ↗
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  className="mt-auto w-fit rounded-full bg-violet px-5 py-2.5 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-50"
                  disabled={!entry.liveUrl || mine || out || busyId !== null}
                  onClick={() => choose(entry.id)}
                >
                  {busyId === entry.id ? "Saving…" : !entry.liveUrl ? "Not live yet" : mine ? "✓ Approved" : out ? "No approvals left" : "Approve"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <StepsDialog
        entry={pickedEntry}
        status={status}
        busy={busyId !== null}
        refresh={loadStatus}
        onApprove={() => pickedEntry && void approve(pickedEntry.id)}
        onClose={() => {
          writePending(null);
          setPicked(null);
        }}
        openConnect={openConnect}
      />
    </div>
  );
}

function StepsDialog({
  entry,
  status,
  busy,
  refresh,
  onApprove,
  onClose,
  openConnect,
}: {
  entry: Entry | null;
  status: VoteStatus;
  busy: boolean;
  refresh: () => Promise<void> | void;
  onApprove: () => void;
  onClose: () => void;
  openConnect: () => void;
}) {
  const verify = useGoodIdVerify(
    () => void refresh(),
    () => `${window.location.origin}${window.location.pathname}#vote`,
  );
  const allDone = status.signedIn && status.verified && status.voted;
  return (
    <Dialog open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogTitle className="pr-10 text-xl font-semibold">Three quick steps, then vote</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-grey-600">
          This keeps it to one real person, one set of {status.max} approvals.
        </DialogDescription>
        <ol className="m-0 mt-5 grid list-none gap-3 p-0">
          <Step n={1} done={status.signedIn} title="Connect your email" note="We create your wallet for you.">
            <button type="button" className={BTN} onClick={openConnect}>Connect with email</button>
          </Step>
          <Step n={2} done={status.verified} title="Verify with GoodDollar" note="A free face check that proves you’re one person.">
            <button type="button" className={BTN} disabled={!status.signedIn || verify.busy} onClick={() => void verify.verify()}>
              {verify.busy ? "Checking…" : "Verify"}
            </button>
            {verify.note && <p role="alert" className="mt-2 text-xs text-danger">{verify.note}</p>}
          </Step>
          <Step n={3} done={status.voted} title="Support us on FlowState" note="One vote from your wallet. We cover the network fee.">
            {status.signedIn && status.verified ? <FlowstateVote onConfirmed={() => void refresh()} /> : <p className="text-xs text-grey-600">Finish the steps above first.</p>}
          </Step>
        </ol>
        <button
          type="button"
          className="mt-5 w-full rounded-full bg-ink px-5 py-3 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-40"
          disabled={!allDone || busy}
          onClick={onApprove}
        >
          {allDone ? `Approve ${entry?.title ?? "this project"}` : "Finish the steps to approve"}
        </button>
      </DialogContent>
    </Dialog>
  );
}

const BTN = "rounded-full bg-violet px-4 py-2 text-sm font-medium text-white outline-none focus-visible:shadow-focus disabled:opacity-50";

function Step({ n, done, title, note, children }: { n: number; done: boolean; title: string; note: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 rounded-block bg-tint p-4">
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${done ? "bg-success text-white" : "bg-surface text-violet"}`}>
        {done ? "✓" : n}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="mb-2 text-xs text-grey-600">{note}</p>
        {!done && children}
      </div>
    </li>
  );
}
