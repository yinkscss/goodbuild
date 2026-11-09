"use client";

import * as React from "react";

import { applyTurnEvent, emptyTurn, type LiveTurn } from "@/lib/live-turn";
import { AUTO_FIX_LEAD, previewFixPrompt, shouldAutoFix, type PreviewError } from "@/lib/preview-errors";
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
  send: (prompt: string, mode: TurnMode) => void;
  /** Stop the running turn and cancel queued follow-ups. */
  stop: () => Promise<void>;
  /** Save one answer to the plan's questions (D32). */
  answerPlan: (messageId: string, questionId: string, answer: PlanAnswer) => void;
  /** Leave the plan and build now, with whatever has been answered so far. */
  skipPlan: () => void;
  revert: (version: number) => Promise<void>;
  /** Reload from the server. Returns the new state, or null if the request failed. */
  refresh: () => Promise<WorkspaceState | null>;
  error: string | null;
  /** Upload a logo, image or design reference to the project. */
  /** Resolves true when the file was saved. */
  upload: (file: File, kind: AssetKind) => Promise<boolean>;
  removeAsset: (id: string) => Promise<void>;
  /** Re-classify an upload (logo, image, design reference); the server re-describes it. */
  changeAssetKind: (id: string, kind: AssetKind) => Promise<void>;
  /** Preview runtime errors: auto-fixed once right after a build (shouldAutoFix). */
  onPreviewError: (error: PreviewError, version: number) => void;
  /** The version to screenshot for the visual check, and whether a check is running. */
  checkVersion: number | null;
  checking: boolean;
  /** The check couldn't produce a result for the latest build. */
  checkFailed: boolean;
  onPreviewCaptured: (shot: { url: string; width: number }, version: number) => Promise<void>;
  onCaptureFailed: () => void;
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

/** Workspace state, streamed turns, a follow-up queue, and recovery after reloads. */
export function useWorkspace(initial: WorkspaceState): UseWorkspace {
  const [state, setState] = React.useState(initial);
  const [live, setLive] = React.useState<LiveTurn | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const projectId = initial.project.id;
  const [autoFixVersion, setAutoFixVersion] = React.useState<number | null>(null);
  const [checkVersion, setCheckVersion] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);
  const [checkFailed, setCheckFailed] = React.useState(false);

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
    async (body: { mode: TurnMode; prompt?: string; userMessageId?: string; skipPlan?: boolean }) => {
      setError(null);
      setCheckFailed(false);
      if (body.prompt) {
        const prompt = body.prompt;
        // Show the prompt at once; the refresh below replaces it with the saved message.
        setState((s) => ({
          ...s,
          messages: [...s.messages, { id: `local-${Date.now()}`, role: "user", content: prompt, status: "queued", meta: { mode: body.mode }, createdAt: new Date().toISOString() }],
        }));
      }
      try {
        const res = await fetch(`/api/projects/${projectId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const failure = await res.json().then((b: { error?: string; message?: string }) => b).catch(() => null);
          setError(failure?.error === "unauthenticated" ? "Your session ended. Sign in again." : res.status === 402 && failure?.message ? failure.message : "The build couldn't be queued. Try again.");
        }
      } catch {
        setError("Couldn't reach GoodBuild. Check your connection and try again.");
      } finally {
        await refresh().catch(() => undefined);
      }
    },
    [projectId, refresh],
  );

  // Sends go out one at a time, so the server queues prompts in the order they were sent
  // (measured: three quick sends raced and were queued out of order).
  const sending = React.useRef<Promise<void>>(Promise.resolve());
  const send = React.useCallback(
    (prompt: string, mode: TurnMode) => {
      const trimmed = prompt.trim();
      if (trimmed) sending.current = sending.current.then(() => enqueue({ mode, prompt: trimmed }));
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
      if (turn.phase === "done" && turn.record.version && turn.record.status === "ready") setCheckVersion(turn.record.version);
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
      await enqueue({ mode: "build", prompt: SKIP_PLAN_TEXT, skipPlan: true });
    });
  }, [enqueue, projectId, state.jobs]);

  const revert = React.useCallback(
    async (version: number) => {
      const res = await fetch(`/api/projects/${projectId}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      if (!res.ok) setError("Couldn't revert right now. Try again after the current build.");
      await refresh();
    },
    [projectId, refresh],
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
          return false;
        }
        await refresh();
        return true;
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
      if (!shouldAutoFix({ error, version, eligibleVersion: autoFixVersion, running: Boolean(attached.current) || state.jobs.length > 0 })) return;
      setAutoFixVersion(null);
      void enqueue({ mode: "build", prompt: previewFixPrompt(error, true) });
    },
    [autoFixVersion, enqueue, state.jobs.length],
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
        if (!res.ok) setCheckFailed(true);
        await refresh();
      } catch {
        setCheckFailed(true);
      } finally {
        setChecking(false);
      }
    },
    [projectId, refresh],
  );

  const onCaptureFailed = React.useCallback(() => {
    setCheckVersion(null);
    setCheckFailed(true);
  }, []);

  return {
    checkVersion,
    checking,
    checkFailed,
    onPreviewCaptured,
    onCaptureFailed,
    onPreviewError,
    changeAssetKind,
    state,
    live,
    running: (Boolean(live) && live?.phase === "running") || state.jobs.length > 0,
    send,
    stop,
    answerPlan,
    skipPlan,
    revert,
    refresh,
    error,
    upload,
    removeAsset,
    uploading: uploading > 0,
  };
}
