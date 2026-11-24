"use client";
import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/context";
import { useSendGate } from "@/components/auth/send-gate";
import { HACKATHON } from "@/lib/hackathon-events";
import { styles } from "./styles";
import { ProjectVoteLink } from "./project-vote-link";

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
  const [projectId, setProjectId] = React.useState<string | null>(null);
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
        if (entry) {
          setFields(entry);
          setProjectId(entry.id);
        }
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
      setProjectId(entry.id);
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
        <a className={styles.btnV} href={HACKATHON.app}>
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
            href={`/hackathon/projects?vote=${saved}`}
          >
            View it on the leaderboard →
          </Link>{" "}
          You can return here to update your links.
        </p>
      )}
      {projectId && <ProjectVoteLink entryId={projectId} />}
    </form>
  );
}
