"use client";
import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { useSendGate } from "@/components/auth/send-gate";
import { useGoodIdVerify } from "@/components/auth/use-goodid-verify";
import { styles } from "./styles";
import { allocateHackathonRewards } from "@/lib/hackathon-rewards";
import { FlowstateVote } from "./flowstate-vote";

type Entry = {
  id: string;
  alias: string;
  title: string;
  pitch: string;
  liveUrl: string;
  sourceUrl: string;
  approvals: number;
};
async function jsonRequest(url: string, body?: unknown) {
  const res = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.message ??
        (res.status === 401
          ? "Please sign in first."
          : "We couldn’t complete that. Please try again."),
    );
  return data;
}
export function ProjectGallery() {
  const { user, ready } = useAuth();
  if (!ready) return <p role="status">Loading…</p>;
  return <Gallery key={user?.id ?? "guest"} />;
}
function Gallery() {
  const [entries, setEntries] = React.useState<Entry[] | null>(null);
  const [error, setError] = React.useState("");
  const [notice, setNotice] = React.useState("");
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [approved, setApproved] = React.useState<Set<string>>(new Set());
  const { user } = useAuth();
  const { openConnect } = useSendGate();
  const [verifiedHere, setVerifiedHere] = React.useState(false);
  const verification = useGoodIdVerify(() => setVerifiedHere(true));
  const verified = user?.verified || verifiedHere;
  React.useEffect(() => {
    let stopped = false;
    void jsonRequest("/api/hackathon/projects")
      .then((data) => {
        if (!stopped) setEntries(data);
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      });
    return () => {
      stopped = true;
    };
  }, []);
  async function approve(id: string) {
    if (!user) {
      openConnect();
      return;
    }
    setBusyId(id);
    setError("");
    setNotice("");
    try {
      await jsonRequest("/api/hackathon/projects", { entryId: id });
      setApproved((previous) => new Set([...previous, id]));
      setEntries(await jsonRequest("/api/hackathon/projects"));
      setNotice("Approval saved. Thank you for supporting this builder.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  }
  const rankedEntries = entries ? allocateHackathonRewards(entries) : [];
  return (
    <>
      <div className="hk-approval-guide">
        <p>
          Approvals are free. Each verified human can approve a project once,
          even across linked wallets. You can support more than one project.
        </p>
        {!user ? (
          <button className={styles.btnV} type="button" onClick={openConnect}>
            1. Connect with email or wallet
          </button>
        ) : !verified ? (
          <button
            className={styles.btnV}
            type="button"
            disabled={verification.busy}
            onClick={() => void verification.verify()}
          >
            {verification.busy
              ? "Checking…"
              : "2. Verify with GoodDollar to approve"}
          </button>
        ) : (
          <p className="mt-3 text-violet">
            ✓ Verified · Choose a published app below to approve it.
          </p>
        )}
        {verified && (
          <div className="hk-flowstate-invite">
            <FlowstateVote />
            <p className="mt-2 text-sm">
              Vote for GoodBuildIt here with your connected wallet to unlock
              free hackathon build credits.
            </p>
          </div>
        )}
        {verification.note && <p role="alert">{verification.note}</p>}
      </div>
      {error && (
        <p role="alert" className="mb-4 text-danger">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 text-violet">
          {notice}
        </p>
      )}
      {!entries ? (
        <p role="status">
          {error ? "Reload this page to try again." : "Loading projects…"}
        </p>
      ) : entries.length === 0 ? (
        <div className={`${styles.card} hk-community-empty`}>
          <h2 className="text-2xl font-bold">
            Be the first to share your idea.
          </h2>
          <p className="mt-3">
            Register an idea today. Add your live app and source code when
            they’re ready.
          </p>
          <Link className={styles.btnV} href="/hackathon/submit">
            Submit your project →
          </Link>
        </div>
      ) : (
        <div className="hk-gallery">
          {rankedEntries.map((entry) => (
            <article
              id={entry.id}
              key={entry.id}
              className={`${styles.card} hk-entry`}
            >
              <div className="flex justify-between gap-3">
                <small>
                  {entry.rank ? `#${entry.rank}` : "Idea"} ·{" "}
                  {entry.liveUrl ? "Published" : "Idea · building soon"}
                </small>
                <strong>
                  {entry.approvals}{" "}
                  {entry.approvals === 1 ? "approval" : "approvals"}
                </strong>
              </div>
              <h2>{entry.title}</h2>
              <p>{entry.pitch}</p>
              <p className="text-sm text-grey-600">Built by {entry.alias}</p>
              <div className="hk-entry-links">
                {entry.liveUrl && (
                  <a
                    className={styles.linkGhost}
                    href={entry.liveUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Try the app ↗
                  </a>
                )}
                {entry.sourceUrl && (
                  <a
                    className={styles.linkGhost}
                    href={entry.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Source code ↗
                  </a>
                )}
                <a className={styles.linkGhost} href={`#${entry.id}`}>
                  Project link
                </a>
              </div>
              <button
                type="button"
                className={styles.btnV}
                disabled={
                  !entry.liveUrl ||
                  busyId !== null ||
                  approved.has(entry.id) ||
                  Boolean(user && !verified)
                }
                onClick={() => void approve(entry.id)}
              >
                {busyId === entry.id
                  ? "Saving approval…"
                  : approved.has(entry.id)
                    ? "✓ Approval saved"
                    : !entry.liveUrl
                      ? "Approvals open after publishing"
                      : "Approve this project"}
              </button>
              <div className="rounded-block bg-tint p-4 text-sm">
                <p className="font-semibold">
                  {entry.totalGd.toLocaleString("en-US")} G$ estimated earnings
                </p>
                <p className="mt-1">
                  {entry.baseGd.toLocaleString("en-US")} G$ base +{" "}
                  {entry.topupGd.toLocaleString("en-US")} G$ approval top-ups
                </p>
                <p className="mt-2 text-xs">
                  Top 10 published projects: 100,000 G$ base each. Every
                  approval adds 50,000 G$ outside the shared reserve. Rankings
                  can change until approvals close; payment is separate.
                </p>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}

/** "olayinka@gmail.com" → "o•••••a@gmail.com": enough to recognise, not to read off a shared screen. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••••";
  const name = email.slice(0, at);
  const shown = name.length <= 2 ? name[0] + "•••" : name[0] + "•".repeat(Math.min(5, name.length - 2)) + name[name.length - 1];
  return shown + email.slice(at);
}

const EMPTY = { alias: "", title: "", pitch: "", liveUrl: "", sourceUrl: "" };
export function SubmissionForm() {
  const { user } = useAuth();
  return <Submission key={user?.id ?? "guest"} />;
}
function Submission() {
  const { user } = useAuth();
  const { openConnect } = useSendGate();
  const [fields, setFields] = React.useState(EMPTY);
  const [email, setEmail] = React.useState(user?.email ?? "");
  /** Once we have an email (the account's, or the one saved at signup) it is shown masked and can't be changed. */
  const [emailLocked, setEmailLocked] = React.useState(Boolean(user?.email));
  const [loading, setLoading] = React.useState(Boolean(user));
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [saved, setSaved] = React.useState<string | null>(null);
  /** Submitting needs verify and vote first (D131). */
  const [voted, setVoted] = React.useState(false);
  React.useEffect(() => {
    if (!user) return;
    let stopped = false;
    void Promise.all([
      jsonRequest("/api/hackathon/projects?mine=1"),
      jsonRequest("/api/hackathon/participants"),
    ])
      .then(([entry, participant]) => {
        if (stopped) return;
        if (entry) setFields(entry);
        if (participant?.email) {
          setEmail(participant.email);
          setEmailLocked(true);
        }
        setVoted(participant?.flowstate === "voted");
      })
      .catch((e) => {
        if (!stopped) setError(e.message);
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => {
      stopped = true;
    };
  }, [user]);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setSaved(null);
    try {
      if (!emailLocked) {
        await jsonRequest("/api/hackathon/participants", { email });
        setEmailLocked(true);
      }
      const entry = await jsonRequest("/api/hackathon/projects", fields);
      setSaved(entry.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <div className={`${styles.card} hk-community-empty`}>
        <h2 className="text-2xl font-bold">First, connect your wallet.</h2>
        <p className="my-4">
          Use your email to create one in a few clicks. Anyone signed in can
          share an idea; verification unlocks credits and approvals.
        </p>
        <button type="button" className={styles.btnV} onClick={openConnect}>
          Connect with email
        </button>
      </div>
    );
  if (loading) return <p role="status">Loading your submission…</p>;
  if (!voted)
    return (
      <div className={`${styles.card} hk-community-empty`}>
        <h2 className="text-2xl font-bold">Verify and vote first.</h2>
        <p className="my-4">
          Verify with GoodDollar and support our project with your vote. Then
          you can submit your project here.
        </p>
        <a className={styles.btnV} href="/home/hackathon#progress">
          Go to the steps
        </a>
      </div>
    );
  return (
    <form
      className="hk-form"
      aria-labelledby="submission-heading"
      action="/api/hackathon/projects"
      method="post"
      onSubmit={submit}
    >
      <h2 id="submission-heading" className="text-2xl font-bold">
        Your builder profile & project
      </h2>
      <div>
        <label htmlFor="builder-alias">Name or Web3 alias (required)</label>
        <input
          className="hk-input"
          id="builder-alias"
          name="alias"
          autoComplete="nickname"
          required
          maxLength={80}
          value={fields.alias}
          onChange={(e) => setFields({ ...fields, alias: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="builder-email">Email (required · private)</label>
        {emailLocked ? (
          <input
            className="hk-input hk-input-locked"
            id="builder-email"
            type="text"
            readOnly
            aria-readonly="true"
            tabIndex={-1}
            value={maskEmail(email)}
            aria-describedby="builder-email-help"
          />
        ) : (
          <input
            className="hk-input"
            id="builder-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby="builder-email-help"
          />
        )}
        <p id="builder-email-help" className="mt-2 text-sm text-grey-600">
          {emailLocked
            ? "Saved for hackathon updates. Only organizers can see it."
            : "For hackathon updates. You can't change it after saving. Only organizers can see it."}
        </p>
      </div>
      <div>
        <label htmlFor="app-title">App name (required)</label>
        <input
          className="hk-input"
          id="app-title"
          name="title"
          required
          maxLength={100}
          value={fields.title}
          onChange={(e) => setFields({ ...fields, title: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="app-pitch">
          Short pitch (required · up to 160 characters)
        </label>
        <textarea
          className="hk-input"
          id="app-pitch"
          name="pitch"
          required
          maxLength={160}
          rows={3}
          value={fields.pitch}
          onChange={(e) => setFields({ ...fields, pitch: e.target.value })}
        />
      </div>
      <div>
        <label htmlFor="app-live">Live app link (optional · add later)</label>
        <input
          className="hk-input"
          id="app-live"
          name="liveUrl"
          type="url"
          placeholder="https://…"
          value={fields.liveUrl}
          onChange={(e) => setFields({ ...fields, liveUrl: e.target.value })}
        />
        <p className="mt-2 text-sm text-grey-600">
          Publish your GoodBuild app and paste its link here to open approvals.
        </p>
      </div>
      <div>
        <label htmlFor="app-source">
          Source code link (optional · add later)
        </label>
        <input
          className="hk-input"
          id="app-source"
          name="sourceUrl"
          type="url"
          placeholder="https://github.com/…"
          value={fields.sourceUrl}
          onChange={(e) => setFields({ ...fields, sourceUrl: e.target.value })}
        />
      </div>
      <p className="text-sm">
        Your connected wallet is your participation wallet:{" "}
        <span className="break-all font-mono">{user.wallet}</span>
      </p>
      <button className={styles.btnV} disabled={busy}>
        {busy ? "Saving…" : "Save project to public showcase"}
      </button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {saved && (
        <p role="status">
          Project saved.{" "}
          <Link
            className={styles.linkGhost}
            href={`/hackathon/projects#${saved}`}
          >
            View it on the leaderboard →
          </Link>{" "}
          You can return here to update your links.
        </p>
      )}
    </form>
  );
}
