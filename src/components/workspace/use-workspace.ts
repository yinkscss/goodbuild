"use client";

import * as React from "react";

import { applyTurnEvent, emptyTurn, type LiveTurn } from "@/lib/live-turn";
import { AUTO_FIX_LEAD, isInfraError, previewFixPrompt, shouldAutoFix, type PreviewError } from "@/lib/preview-errors";
import { backoffMs, createJobStreamParser } from "@/lib/job-stream";
import { SKIP_PLAN_TEXT } from "@/lib/plan";
import type { PlanAnswer, TurnMode, TurnRecord } from "@/lib/turn-types";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import type { WorkspaceState } from "@/server/workspace-state";

export interface UseWorkspace {
  state: WorkspaceState;
  live: LiveTurn | null;
  /** A turn is running or queued for this project (on the server, P18). */
  running: boolean;
  /** Queue a prompt on the server; it runs after any turn ahead of it (AI_AGENT.md §4). */
  /** `skipPlan` builds even on a project's first message, for a plan the person already approved. */
  send: (prompt: string, mode: TurnMode, opts?: { buildFromIntake?: boolean; skipPlan?: boolean }) => void;
  /** Stop the running turn and cancel queued follow-ups. */
  stop: () => Promise<void>;
  /**
   * Continue a failed build from its saved files (D164). `note` tells the builder what else is wrong (the
   * preview's crash). When GoodBuild's repair allowance doesn't cover it, it runs on credits, as the cost beside
   * the prompt box said; there is no second question.
   */
  retry: (jobId: string, useCredits?: boolean, note?: string) => void;
  /** The preview's latest crash since the last message, for the one problem card (D164). */
  previewError: PreviewError | null;
  /** Save one answer to the plan's questions (D32). */
  answerPlan: (messageId: string, questionId: string, answer: PlanAnswer) => void;
  /** Leave the plan and build now, with whatever has been answered so far. */
  skipPlan: () => void;
  revert: (version: number) => Promise<void>;
  /** Reload from the server. Returns the new state, or null if the request failed. */
  refresh: () => Promise<WorkspaceState | null>;
  error: string | null;
  /** The last send was refused because the AI credit is used up: the chat offers a one-click top-up. */
  needsCredits: boolean;
  clearNeedsCredits: () => void;
  /** Upload a logo, image or design reference to the project. */
  upload: (file: File, kind: AssetKind) => Promise<void>;
  removeAsset: (id: string) => Promise<void>;
  /** Re-classify an upload (logo, image, design reference); the server re-describes it. */
  changeAssetKind: (id: string, kind: AssetKind) => Promise<void>;
  /** Preview runtime errors: auto-fixed once right after a build (shouldAutoFix). */
  onPreviewError: (error: PreviewError, version: number) => void;
  /** The version to screenshot for the visual check, and whether a check is running. */
  checkVersion: number | null;
  checking: boolean;
  /** Why the check has no result for the latest build, in words for the chat; null when nothing went wrong. */
  checkFailed: string | null;
  onPreviewCaptured: (shot: { url: string; width: number }, version: number) => Promise<void>;
  onCaptureFailed: () => void;
  onCaptureSkipped: () => void;
  uploading: boolean;
}

/**
 * Data URLs for the project's assets, keyed by file name. The preview runs on another https
 * origin that can't load images from the GoodBuild server in development (P17), so the
 * workspace fetches each asset once (same origin, with the session) and inlines it.
 */
export function useAssetDataUrls(projectId: string, assets: Array<AssetInfo & { url?: string }>): Record<string, string> {
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const loaded = React.useRef(new Map<string, string>());
  const key = assets.map((a) => `${a.id}:${a.name}:${a.url ?? ""}`).join("|");
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const a of assets) {
        // Production on a public https origin: the preview loads the signed URL itself.
        if (a.url) {
          next[a.name] = a.url;
          continue;
        }
        let url = loaded.current.get(a.id);
        if (!url) {
          const res = await fetch(`/api/projects/${projectId}/assets/${a.id}`).catch(() => null);
          if (!res?.ok) continue;
          const blob = await res.blob();
          url = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
          }).catch(() => "");
          if (!url) continue;
          loaded.current.set(a.id, url);
        }
        next[a.name] = url;
      }
      if (!cancelled) setUrls(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures the asset list
  }, [projectId, key]);
  return urls;
}

export const CHECK_FAILED = "The visual check couldn't run for this build. The build itself is fine.";

/**
 * What to say when the server refuses or fails a visual check. Out of free AI or credit is not a
 * fault, so it says so instead of "couldn't run"; a too-large screenshot is named too.
 */
export async function visualCheckFailure(res: Response): Promise<string> {
  if (res.status === 402) return "The visual check was skipped: no AI credit is left for it. The build itself is fine.";
  if (res.status === 413) return "The visual check was skipped: the page was too large to screenshot. The build itself is fine.";
  return CHECK_FAILED;
}

/** Workspace state, streamed turns, a follow-up queue, and recovery after reloads. */
export function useWorkspace(initial: WorkspaceState): UseWorkspace {
  const [state, setState] = React.useState(initial);
  const [live, setLive] = React.useState<LiveTurn | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [needsCredits, setNeedsCredits] = React.useState(false);
  const [previewError, setPreviewErrorState] = React.useState<PreviewError | null>(null);
  // The crash as it is now, for a retry to remember which one its note carried (D164).
  const previewErrorRef = React.useRef<PreviewError | null>(null);
  const setPreviewError = React.useCallback((next: PreviewError | null | ((current: PreviewError | null) => PreviewError | null)) => {
    const value = typeof next === "function" ? next(previewErrorRef.current) : next;
    previewErrorRef.current = value;
    setPreviewErrorState(value);
  }, []);
  const projectId = initial.project.id;
  const [autoFixVersion, setAutoFixVersion] = React.useState<number | null>(null);
  const [checkVersion, setCheckVersion] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [checkFailed, setCheckFailed] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (!res.ok) return null;
    const next = (await res.json()) as WorkspaceState;
    setState(next);
    return next;
  }, [projectId]);

  /**
   * Queue a turn on the server (P18). The worker runs it; this browser only watches. Follow-ups
   * queue behind a running turn on the server, so they survive a reload or a closed tab.
   */
  const enqueue = React.useCallback(
    async (body: { mode: TurnMode; prompt?: string; userMessageId?: string; buildFromIntake?: boolean; skipPlan?: boolean; assetIds?: string[] }) => {
      setError(null);
      setCheckFailed(null);
      // A new message answers whatever the preview showed; a crash after it is shown again.
      setPreviewError(null);
      if (body.prompt) {
        const prompt = body.prompt;
        const sent = new Set(body.assetIds ?? []);
        // Show the prompt (and the files going with it) at once; the refresh below replaces it with the saved message.
        setState((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { id: `local-${Date.now()}`, role: "user", content: prompt, status: "queued", meta: { mode: body.mode, assetIds: body.assetIds ?? [] }, createdAt: new Date().toISOString() },
          ],
          assets: s.assets.map((a) => (sent.has(a.id) ? { ...a, pending: false } : a)),
        }));
      }
      try {
        const res = await fetch(`/api/projects/${projectId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) setNeedsCredits(false);
        if (!res.ok) {
          if (res.status === 402) setNeedsCredits(true);
          const failure = await res.json().then((b: { error?: string; message?: string }) => b).catch(() => null);
          setError(failure?.error === "unauthenticated" ? "Your session ended. Sign in again." : res.status === 402 && failure?.message ? failure.message : "The build couldn't be queued. Try again.");
        }
      } catch {
        setError("Couldn't reach GoodBuild. Check your connection and try again.");
      } finally {
        await refresh().catch(() => undefined);
      }
    },
    [projectId, refresh, setPreviewError],
  );

  const retry = React.useCallback((jobId: string, useCredits = false, note?: string) => {
    // The crash this note describes: cleared once a build has it, unless a newer one came meanwhile.
    const carried = note ? previewErrorRef.current : null;
    sending.current = sending.current.then(async () => {
      setError(null);
      try {
        const post = (paid: boolean) => fetch(`/api/projects/${projectId}/turns/${jobId}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ useCredits: paid, ...(note ? { note: note.slice(0, 3000) } : {}) }) });
        let res = await post(useCredits);
        let body = res.ok ? {} : await res.json().catch(() => ({})) as { message?: string; error?: string };
        // The repair allowance doesn't cover it: run on credits, as the cost beside the prompt box said (D164, owner).
        if (!res.ok && !useCredits && body.error === "funding_unavailable") {
          res = await post(true);
          body = res.ok ? {} : await res.json().catch(() => ({})) as { message?: string; error?: string };
        }
        if (!res.ok) {
          // A build running in another project isn't about credits: say so, and keep the preview's crash for the next try.
          if (res.status === 402 && body.error !== "one_build_at_a_time") setNeedsCredits(true);
          else setError(body.message ?? "Couldn't pick up this build. Reload and try again.");
        } else {
          setNeedsCredits(false);
          // The builder has the crash now; a newer one reported meanwhile stays.
          if (carried) setPreviewError((current) => (current === carried ? null : current));
        }
      } catch { setError("Couldn't reach GoodBuild. Your files are saved."); }
      await refresh().catch(() => undefined);
    });
  }, [projectId, refresh, setPreviewError]);

  // Sends go out one at a time, so the server queues prompts in the order they were sent
  // (measured: three quick sends raced and were queued out of order).
  const sending = React.useRef<Promise<void>>(Promise.resolve());
  // The files waiting above the composer go with the next message sent (read at send time).
  const pendingAssets = React.useRef<string[]>([]);
  React.useLayoutEffect(() => {
    pendingAssets.current = state.assets.filter((a) => a.pending).map((a) => a.id);
  }, [state.assets]);
  const send = React.useCallback(
    (prompt: string, mode: TurnMode, opts?: { buildFromIntake?: boolean; skipPlan?: boolean }) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      const assetIds = pendingAssets.current;
      pendingAssets.current = [];
      sending.current = sending.current.then(() => enqueue({ mode, prompt: trimmed, assetIds, ...(opts?.buildFromIntake ? {buildFromIntake:true}:{}), ...(opts?.skipPlan ? { skipPlan: true } : {}) }));
    },
    [enqueue],
  );

  /** Watch one job's events: replay from the start, reconnect with ?after= and backoff. */
  const attached = React.useRef<string | null>(null);
  const attach = React.useCallback(
    async (jobId: string, mode: TurnMode, prompt: string) => {
      if (attached.current === jobId) return;
      attached.current = jobId;
      let turn = emptyTurn(mode);
      turn.record.jobId = jobId;
      setLive(turn);
      let after = -1;
      let failures = 0;
      let ended = false;
      while (!ended && attached.current === jobId) {
        try {
          const res = await fetch(`/api/projects/${projectId}/turns/${jobId}/events?after=${after}`, { cache: "no-store" });
          if (res.status === 404) break;
          if (!res.ok || !res.body) throw new Error(String(res.status));
          failures = 0;
          const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
          const parse = createJobStreamParser();
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            for (const m of parse(value)) {
              if (m.id !== null) after = m.id;
              if (m.event === "end") ended = true;
              else if (m.data) {
                turn = applyTurnEvent(turn, m.data);
                setLive(turn);
              }
            }
          }
        } catch {
          failures++;
          await new Promise((r) => setTimeout(r, backoffMs(failures)));
        }
      }
      if (attached.current !== jobId) return;
      // A build this browser just watched finish may get one automatic preview fix...
      if (turn.phase === "done" && turn.record.version && !prompt.startsWith(AUTO_FIX_LEAD)) setAutoFixVersion(turn.record.version);
      // ...and one visual check of the preview (an auto-fix build is checked too).
      // Not when the builder already looked at the page itself on the server (D87).
      if (turn.phase === "done" && turn.record.version && turn.record.status === "ready" && !turn.record.review) setCheckVersion(turn.record.version);
      await refresh().catch(() => undefined);
      setLive(null);
      attached.current = null;
    },
    [projectId, refresh],
  );

  // Watch the oldest active job (running, or queued next). After a reload this replays the
  // events so far, so the build continues on screen where it was.
  const head = state.jobs[0];
  React.useEffect(() => {
    if (!head || attached.current) return;
    const prompt = state.messages.find((m) => m.id === head.userMessageId)?.content ?? "";
    void attach(head.id, head.mode as TurnMode, prompt);
  }, [head, attach, state.messages]);

  // First visit after the landing page: queue the waiting prompt automatically.
  const autoQueued = React.useRef(false);
  React.useEffect(() => {
    const last = state.messages.at(-1);
    if (autoQueued.current || state.jobs.length || !last || last.role !== "user" || last.status !== "queued" || last.id.startsWith("local-")) return;
    autoQueued.current = true;
    void enqueue({ mode: "build", userMessageId: last.id });
  }, [enqueue, state.jobs.length, state.messages]);

  /** Stop the running turn and cancel queued follow-ups (they stay visible to resend). */
  const stop = React.useCallback(async () => {
    const job = state.jobs[0];
    if (!job) return;
    const res = await fetch(`/api/projects/${projectId}/turns/${job.id}/stop`, { method: "POST" }).catch(() => null);
    if (!res?.ok) setError("Couldn't stop the build. Try again.");
    await refresh();
  }, [projectId, refresh, state.jobs]);

  /** Shown at once and saved in the background, one at a time, so a reload resumes from here. */
  const answerPlan = React.useCallback(
    (messageId: string, questionId: string, answer: PlanAnswer) => {
      setError(null);
      setState((s) => ({
        ...s,
        messages: s.messages.map((m) => {
          const record = m.meta as TurnRecord | null;
          if (m.id !== messageId || !record?.intake) return m;
          return { ...m, meta: { ...record, intake: { ...record.intake, answers: { ...record.intake.answers, [questionId]: answer } } } };
        }),
      }));
      sending.current = sending.current.then(async () => {
        const res = await fetch(`/api/projects/${projectId}/plan`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messageId, questionId, answer }),
        }).catch(() => null);
        if (!res?.ok) setError("Couldn't save that answer. It still counts for now, but check your connection.");
      });
    },
    [projectId],
  );

  const skipPlan = React.useCallback(() => {
    sending.current = sending.current.then(async () => {
      // While the questions are still being written: stop that turn first. Nothing is lost.
      const job = state.jobs[0];
      if (job) await fetch(`/api/projects/${projectId}/turns/${job.id}/stop`, { method: "POST" }).catch(() => null);
      await enqueue({ mode: "build", prompt: SKIP_PLAN_TEXT, skipPlan: true, buildFromIntake:true });
    });
  }, [enqueue, projectId, state.jobs]);

  const revert = React.useCallback(
    async (version: number) => {
      // The crash showing now belongs to the version being left (D164): gone once the revert works, unless a newer one came.
      const left = previewErrorRef.current;
      const res = await fetch(`/api/projects/${projectId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) setError("Couldn't go back right now. Try again after the current build.");
      else if (left) setPreviewError((current) => (current === left ? null : current));
      await refresh();
    },
    [projectId, refresh, setPreviewError],
  );

  const [uploading, setUploading] = React.useState(0);
  const upload = React.useCallback(
    async (file: File, kind: AssetKind) => {
      setError(null);
      setUploading((n) => n + 1);
      try {
        const body = new FormData();
        body.set("file", file);
        body.set("kind", kind);
        const res = await fetch(`/api/projects/${projectId}/assets`, { method: "POST", body });
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
          setError(b.message ?? (b.error === "unauthenticated" ? "Your session ended. Sign in again." : "That upload didn't work. Try again."));
          return;
        }
        await refresh();
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [projectId, refresh],
  );

  const removeAsset = React.useCallback(
    async (id: string) => {
      const res = await fetch(`/api/projects/${projectId}/assets/${id}`, { method: "DELETE" });
      if (!res.ok) setError("Couldn't remove that file. Try again.");
      await refresh();
    },
    [projectId, refresh],
  );

  const changeAssetKind = React.useCallback(
    async (id: string, kind: AssetKind) => {
      setUploading((n) => n + 1);
      try {
        const res = await fetch(`/api/projects/${projectId}/assets/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind }),
        });
        if (!res.ok) setError("Couldn't change that file's role. Try again.");
        await refresh();
      } finally {
        setUploading((n) => n - 1);
      }
    },
    [projectId, refresh],
  );

  /** The preview reported an error: fix it automatically once, if policy allows (P17). */
  const onPreviewError = React.useCallback(
    (error: PreviewError, version: number) => {
      if (!isInfraError(error)) setPreviewError(error);
      if (!shouldAutoFix({ error, version, eligibleVersion: autoFixVersion, running: Boolean(attached.current) || state.jobs.length > 0 })) return;
      setAutoFixVersion(null);
      void enqueue({ mode: "build", prompt: previewFixPrompt(error, true) });
    },
    [autoFixVersion, enqueue, state.jobs.length, setPreviewError],
  );

  /** A screenshot of the version just built: ask the server's vision check, then show the result. */
  const onPreviewCaptured = React.useCallback(
    async (shot: { url: string; width: number }, version: number) => {
      setCheckVersion(null);
      setChecking(true);
      try {
        const res = await fetch(`/api/projects/${projectId}/visual-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, width: Math.round(shot.width), image: shot.url }),
        });
        if (!res.ok) setCheckFailed(await visualCheckFailure(res));
        await refresh();
      } catch {
        setCheckFailed(CHECK_FAILED);
      } finally {
        setChecking(false);
      }
    },
    [projectId, refresh],
  );

  const onCaptureFailed = React.useCallback(() => {
    setCheckVersion(null);
    setCheckFailed(CHECK_FAILED);
  }, []);

  /** The preview can't be screenshotted here (the own build): an expected skip, not a failure. */
  const onCaptureSkipped = React.useCallback(() => setCheckVersion(null), []);

  return {
    checkVersion,
    checking,
    checkFailed,
    onPreviewCaptured,
    onCaptureFailed,
    onCaptureSkipped,
    onPreviewError,
    changeAssetKind,
    state,
    live,
    running: (Boolean(live) && live?.phase === "running") || state.jobs.length > 0,
    send,
    retry,
    previewError,
    stop,
    answerPlan,
    skipPlan,
    revert,
    refresh,
    error,
    needsCredits,
    clearNeedsCredits: () => setNeedsCredits(false),
    upload,
    removeAsset,
    uploading: uploading > 0,
  };
}
