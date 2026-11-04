"use client";

import * as React from "react";

import { applyTurnEvent, emptyTurn, type LiveTurn } from "@/lib/live-turn";
import { AUTO_FIX_LEAD, previewFixPrompt, shouldAutoFix, type PreviewError } from "@/lib/preview-errors";
import { createSseParser } from "@/lib/sse";
import type { TurnEvent, TurnMode } from "@/lib/turn-types";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import type { WorkspaceState } from "@/server/workspace-state";

export interface QueuedPrompt {
  id: string;
  prompt: string;
  mode: TurnMode;
}

export interface UseWorkspace {
  state: WorkspaceState;
  live: LiveTurn | null;
  queue: QueuedPrompt[];
  running: boolean;
  /** Send a prompt now, or queue it if a turn is running (AI_AGENT.md §4). */
  send: (prompt: string, mode: TurnMode) => void;
  revert: (version: number) => Promise<void>;
  refresh: () => Promise<void>;
  error: string | null;
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
  onPreviewCaptured: (shot: { url: string; width: number }, version: number) => Promise<void>;
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
  const [queue, setQueue] = React.useState<QueuedPrompt[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const runningRef = React.useRef(false);
  const projectId = initial.project.id;
  const [autoFixVersion, setAutoFixVersion] = React.useState<number | null>(null);
  const [checkVersion, setCheckVersion] = React.useState<number | null>(null);
  const [checking, setChecking] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}`, { cache: "no-store" });
    if (res.ok) setState((await res.json()) as WorkspaceState);
  }, [projectId]);

  const run = React.useCallback(
    async (body: { mode: TurnMode; prompt?: string; userMessageId?: string }) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setError(null);
      // Show the user's prompt immediately (the server stores it as part of the turn).
      if (body.prompt) {
        const prompt = body.prompt;
        setState((s) => ({
          ...s,
          messages: [
            ...s.messages,
            { id: `local-${Date.now()}`, role: "user", content: prompt, status: "done", meta: { mode: body.mode }, createdAt: new Date().toISOString() },
          ],
        }));
      }
      let turn = emptyTurn(body.mode);
      setLive(turn);
      try {
        const res = await fetch(`/api/projects/${projectId}/turns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok || !res.body) {
          const code = await res.json().then((b: { error?: string }) => b.error).catch(() => undefined);
          throw new Error(code === "unauthenticated" ? "Your session ended. Sign in again." : "The build couldn't start. Try again.");
        }
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        const parse = createSseParser<TurnEvent>();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of parse(value)) {
            turn = applyTurnEvent(turn, event);
            setLive(turn);
          }
        }
        if (turn.phase === "busy") setError("Another build is still running for this project. It'll show here when it finishes.");
        // A build this browser just watched finish may get one automatic preview fix.
        if (turn.phase === "done" && turn.record.version && !(body.prompt ?? "").startsWith(AUTO_FIX_LEAD)) setAutoFixVersion(turn.record.version);
        // ...and one visual check of the preview (an auto-fix build is checked too).
        if (turn.phase === "done" && turn.record.version && turn.record.status === "ready") setCheckVersion(turn.record.version);
      } catch (e) {
        // The turn may still be running server-side; the reload below picks it up.
        setError(e instanceof Error ? e.message : "The connection dropped. Reloading the project.");
      } finally {
        await refresh().catch(() => undefined);
        setLive(null);
        runningRef.current = false;
      }
    },
    [projectId, refresh],
  );

  const send = React.useCallback(
    (prompt: string, mode: TurnMode) => {
      const trimmed = prompt.trim();
      if (!trimmed) return;
      if (runningRef.current || state.project.building) {
        setQueue((q) => [...q, { id: `${Date.now()}-${q.length}`, prompt: trimmed, mode }]);
        return;
      }
      void run({ mode, prompt: trimmed });
    },
    [run, state.project.building],
  );

  // Run the next queued follow-up once the current turn finishes.
  React.useEffect(() => {
    if (live || state.project.building || !queue.length) return;
    const [next, ...rest] = queue;
    const t = setTimeout(() => {
      setQueue(rest);
      void run({ mode: next.mode, prompt: next.prompt });
    }, 0);
    return () => clearTimeout(t);
  }, [live, queue, run, state.project.building]);

  // First visit after the landing page: answer the queued prompt automatically.
  React.useEffect(() => {
    const last = state.messages.at(-1);
    if (live || state.project.building || !last || last.role !== "user" || last.status !== "queued") return;
    const t = setTimeout(() => void run({ mode: "build", userMessageId: last.id }), 0);
    return () => clearTimeout(t);
  }, [live, run, state.messages, state.project.building]);

  // A turn running elsewhere (another tab, or a reload mid-build): poll until it ends.
  React.useEffect(() => {
    if (live || !state.project.building) return;
    const t = setInterval(() => void refresh(), 2500);
    return () => clearInterval(t);
  }, [live, refresh, state.project.building]);

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
      if (!shouldAutoFix({ error, version, eligibleVersion: autoFixVersion, running: runningRef.current })) return;
      setAutoFixVersion(null);
      void run({ mode: "build", prompt: previewFixPrompt(error, true) });
    },
    [autoFixVersion, run],
  );

  /** A screenshot of the version just built: ask the server's vision check, then show the result. */
  const onPreviewCaptured = React.useCallback(
    async (shot: { url: string; width: number }, version: number) => {
      setCheckVersion(null);
      setChecking(true);
      try {
        await fetch(`/api/projects/${projectId}/visual-check`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ version, width: Math.round(shot.width), image: shot.url }),
        });
        await refresh();
      } catch {
        // Best effort: a failed check shows nothing.
      } finally {
        setChecking(false);
      }
    },
    [projectId, refresh],
  );

  return {
    checkVersion,
    checking,
    onPreviewCaptured,
    onPreviewError,
    changeAssetKind,
    state,
    live,
    queue,
    running: Boolean(live) || state.project.building,
    send,
    revert,
    refresh,
    error,
    upload,
    removeAsset,
    uploading: uploading > 0,
  };
}
