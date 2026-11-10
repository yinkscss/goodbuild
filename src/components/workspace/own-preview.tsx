"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { isInfraError, type PreviewError } from "@/lib/preview-errors";
import { cn } from "@/lib/utils";

interface PreviewInfo {
  url: string;
  origin: string;
  buildId: string;
}

type Status = "building" | "loading" | "ready" | "failed";

/** How long the built app may take to say it is up before the build is asked for again. */
const READY_TIMEOUT_MS = 12_000;

/**
 * GoodBuild's own preview (D69): asks the server to build the saved project, frames the result
 * from the project's preview host and listens to the small script inside it for "ready" and for
 * errors. To the person it is the same frame as the Sandpack preview.
 */
export function OwnPreview({
  projectId,
  reloadKey,
  device,
  onRuntimeError,
  onError,
  onUrl,
}: {
  projectId: string;
  /** Changes when the person presses refresh: load the same build again. */
  reloadKey: number;
  device: "desktop" | "mobile";
  /** Called once per error, for the workspace's auto-fix. */
  onRuntimeError?: (error: PreviewError) => void;
  /** The error to show under the frame, or null when there is none. */
  onError: (error: PreviewError | null) => void;
  /** The preview's address, for "open in a new tab". */
  onUrl?: (url: string | null) => void;
}) {
  const [info, setInfo] = React.useState<PreviewInfo | null>(null);
  const [status, setStatus] = React.useState<Status>("building");
  const [error, setErrorState] = React.useState<PreviewError | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const frame = React.useRef<HTMLIFrameElement>(null);
  const report = React.useRef(onRuntimeError);
  const tellUrl = React.useRef(onUrl);
  const tellError = React.useRef(onError);
  React.useEffect(() => {
    report.current = onRuntimeError;
    tellUrl.current = onUrl;
    tellError.current = onError;
  }, [onRuntimeError, onUrl, onError]);
  const setError = React.useCallback((e: PreviewError | null) => {
    setErrorState(e);
    tellError.current(e);
  }, []);

  /** Ask for the build again, from a click or a timer (never from an effect's body). */
  const retry = React.useCallback(() => {
    setError(null);
    setStatus("building");
    setAttempt((n) => n + 1);
  }, [setError]);

  // Build (or reuse the build of) the saved files. The workspace remounts this component when the
  // saved files change (its key), so state always starts from "building".
  React.useEffect(() => {
    const abort = new AbortController();
    fetch(`/api/projects/${projectId}/preview`, { method: "POST", signal: abort.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as Partial<PreviewInfo> & { message?: string; details?: string[] };
        if (res.ok && body.url && body.origin && body.buildId) {
          setInfo({ url: body.url, origin: body.origin, buildId: body.buildId });
          tellUrl.current?.(body.url);
          setStatus("loading");
          return;
        }
        if (res.status === 422) {
          // The app didn't build: that is an error in the app, shown with "Fix it" like any other.
          const first = body.details?.[0] ?? body.message ?? "The app didn't build.";
          const at = /^(src\/[^:]+):(\d+): (.*)$/.exec(first);
          const e: PreviewError = at ? { title: "Build error", message: at[3], path: at[1], line: Number(at[2]) } : { title: "Build error", message: first };
          setError(e);
          report.current?.(e);
        }
        setStatus("failed");
      })
      .catch(() => {
        if (!abort.signal.aborted) setStatus("failed");
      });
    return () => abort.abort();
  }, [projectId, attempt, setError]);

  // What the app says about itself. Only the framed preview is listened to.
  React.useEffect(() => {
    if (!info) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== info.origin || event.source !== frame.current?.contentWindow) return;
      const data = event.data as { gb?: string; type?: string; title?: string; message?: string; path?: string } | null;
      if (!data || data.gb !== "preview") return;
      if (data.type === "ready") setStatus("ready");
      else if (data.type === "error") {
        const e: PreviewError = { title: String(data.title ?? "Error"), message: String(data.message ?? ""), ...(typeof data.path === "string" ? { path: data.path } : {}) };
        // An error before "ready" still means the page loaded.
        setStatus("ready");
        if (isInfraError(e)) return;
        setError(e);
        report.current?.(e);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [info, setError]);

  // The server keeps builds in memory, so one can be gone (a restart). Ask once more, then say so.
  React.useEffect(() => {
    if (status !== "loading") return;
    const timer = window.setTimeout(() => {
      if (attempt === 0) retry();
      else setStatus("failed");
    }, READY_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status, attempt, reloadKey, retry]);

  const rounded = device === "mobile";
  return (
    <div className={cn("relative mx-auto h-full transition-[max-width] duration-200 ease-gb", rounded ? "max-w-[390px] py-3" : "max-w-none")}>
        {status !== "ready" && (
          <div className={cn("absolute inset-x-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface p-8 text-center", rounded ? "inset-y-3 rounded-[24px]" : "inset-y-0 rounded-block")} role="status">
            <LogoMark className={cn("size-10 opacity-80", status !== "failed" && "animate-pulse")} />
            <p className="max-w-xs text-sm text-grey-600">{status === "failed" ? (error ? "The app has an error, so there is nothing to show yet." : "The preview didn't start.") : "Starting the preview. This takes a few seconds."}</p>
            {status === "failed" && !error && (
              <Button variant="chip" size="sm" onClick={retry}>
                <RotateCw />
                Try again
              </Button>
            )}
          </div>
        )}
        {info && status !== "failed" && (
          <iframe
            ref={frame}
            key={`${info.buildId}:${reloadKey}:${attempt}`}
            src={info.url}
            title="App preview"
            // Its own origin, never the main site's: generated code runs here.
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            allow="clipboard-write"
            className={cn("size-full border-0 bg-surface", rounded ? "rounded-[24px] shadow-card" : "")}
          />
        )}
    </div>
  );
}
