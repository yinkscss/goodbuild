"use client";

import * as React from "react";
import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
  useSandpackNavigation,
  type SandpackTheme,
} from "@codesandbox/sandpack-react";
import { contractAddressKey } from "@/lib/deploy/wiring";
import { ExternalLink, Monitor, RotateCw, ShieldAlert, Smartphone } from "lucide-react";

import { LogoMark } from "@/components/brand/logo";
import { chainLabel } from "@/lib/deploy/explorer";
import { OVERRIDE_KEY, chooseEngine, failedKey, parseOverride, type EngineOverride, type PreviewEngine } from "@/lib/preview-engine";
import { isInfraError, type PreviewError } from "@/lib/preview-errors";
import { OwnPreview } from "./own-preview";
import { CAPTURE_DEPENDENCY, CAPTURE_ENTRY, CAPTURE_FILES, capturePreview } from "./preview-capture";
import { PreviewErrorNotice } from "./preview-error-notice";
import { cn } from "@/lib/utils";

type Tab = "preview" | "code" | "contract";

/** Light Sandpack theme from DESIGN_SYSTEM §4 (violet keywords, sparing pink strings, grey comments). */
export const theme: SandpackTheme = {
  colors: {
    surface1: "#FFFFFF",
    surface2: "#F3EEF8",
    surface3: "#F5F5F5",
    clickable: "#7A7A7A",
    base: "#111111",
    disabled: "#A6A6A6",
    hover: "#592E81",
    accent: "#592E81",
    error: "#D2384B",
    errorSurface: "#FCEBED",
  },
  syntax: {
    plain: "#111111",
    comment: { color: "#A6A6A6", fontStyle: "italic" },
    keyword: "#592E81",
    tag: "#592E81",
    punctuation: "#7A7A7A",
    definition: "#1A0D26",
    property: "#1A0D26",
    static: "#C77700",
    // Pink, darkened from #FF85D9 so strings stay readable on white.
    string: "#B83E92",
  },
  font: {
    body: "var(--font-inter), sans-serif",
    mono: "var(--font-jetbrains), monospace",
    size: "13px",
    lineHeight: "20px",
  },
};

export type { PreviewError };

/**
 * Files Sandpack bundles: everything except contracts (shown in the Contract tab). Uploaded
 * assets are referenced as "/assets/<name>"; those literal paths become data URLs here, in the
 * preview only, because Sandpack's https origin can't load images from the GoodBuild server in
 * development (P17). Saved files keep the stable paths.
 */
export function toAppFiles(files: Record<string, string>, assetUrls: Record<string, string> = {}) {
  const names = Object.keys(assetUrls).sort((a, b) => b.length - a.length);
  const re = names.length ? new RegExp(`/assets/(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?![A-Za-z0-9._-])`, "g") : null;
  const out: Record<string, string> = {};
  for (const [p, c] of Object.entries(files)) {
    if (p.startsWith("contracts/")) continue;
    out[`/${p}`] = re && c.includes("/assets/") ? c.replace(re, (_m, name: string) => assetUrls[name]) : c;
  }
  return out;
}

/** The app plus the screenshot helper for the visual check: preview only, never saved with the project. */
export function toSandpack(files: Record<string, string>, assetUrls: Record<string, string> = {}) {
  return { ...toAppFiles(files, assetUrls), ...CAPTURE_FILES };
}

export function dependencies(files: Record<string, string>): Record<string, string> {
  try {
    return (JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string> }).dependencies ?? {};
  } catch {
    return {};
  }
}

/** How long Sandpack's bundler may stay silent before the workspace uses its own build. */
const SANDPACK_STUCK_MS = 20_000;

/**
 * Which preview this project gets (src/lib/preview-engine.ts). The owner's override comes from
 * ?preview=own|sandpack|auto on the address and is remembered in this browser; nobody else sees it.
 */
function usePreviewEngine(projectId: string, files: Record<string, string>): { engine: PreviewEngine; sandpackFailed: () => void } {
  // Read once, when the panel mounts: it only ever renders in the browser.
  const [override] = React.useState<EngineOverride>(() => {
    try {
      const asked = parseOverride(new URLSearchParams(window.location.search).get("preview"));
      if (asked === "auto") window.localStorage.removeItem(OVERRIDE_KEY);
      else if (asked) window.localStorage.setItem(OVERRIDE_KEY, asked);
      const saved = parseOverride(window.localStorage.getItem(OVERRIDE_KEY));
      return saved === "own" || saved === "sandpack" ? saved : null;
    } catch {
      return null; // storage is blocked: no override
    }
  });
  const [failed, setFailed] = React.useState(() => {
    try {
      return window.sessionStorage.getItem(failedKey(projectId)) === "1";
    } catch {
      return false;
    }
  });
  const sandpackFailed = React.useCallback(() => {
    setFailed(true);
    try {
      window.sessionStorage.setItem(failedKey(projectId), "1");
    } catch {
      /* fine */
    }
  }, [projectId]);
  return { engine: chooseEngine({ files, override, sandpackFailed: failed }), sandpackFailed };
}

export function PreviewPanel({
  projectId,
  chainId,
  files,
  assetUrls,
  version,
  contracts,
  onFix,
  fixDisabled,
  onRuntimeError,
  checkVersion,
  onCaptured,
  onCaptureFailed,
}: {
  projectId: string;
  chainId: number;
  files: Record<string, string>;
  assetUrls?: Record<string, string>;
  onRuntimeError?: (error: PreviewError) => void;
  /** The version to screenshot once it renders (the build this browser just finished). */
  checkVersion?: number | null;
  onCaptured?: (shot: { url: string; width: number }, version: number) => void;
  onCaptureFailed?: () => void;
  version: number;
  contracts: Array<{ name: string; file: string; bytecodeBytes: number }>;
  onFix: (prompt: string) => void;
  fixDisabled: boolean;
}) {
  const [tab, setTab] = React.useState<Tab>("preview");
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const frameRef = React.useRef<HTMLDivElement>(null);
  const hasApp = "src/App.tsx" in files;
  const sandpackFiles = React.useMemo(() => toSandpack(files, assetUrls), [files, assetUrls]);
  const deps = React.useMemo(() => dependencies(files), [files]);
  const visible = React.useMemo(() => Object.keys(sandpackFiles).filter((p) => p.startsWith("/src/")).sort(), [sandpackFiles]);
  const solFiles = Object.keys(files).filter((p) => p.startsWith("contracts/") && p.endsWith(".sol")).sort();
  const { engine, sandpackFailed } = usePreviewEngine(projectId, files);
  const [reloads, setReloads] = React.useState(0);
  const [ownUrl, setOwnUrl] = React.useState<string | null>(null);
  const buildKey = `${version}:${contractAddressKey(files)}`;
  // Kept with the build it came from, so a new build starts with no error showing.
  const [ownErrorAt, setOwnErrorAt] = React.useState<{ key: string; error: PreviewError } | null>(null);
  const ownError = ownErrorAt?.key === buildKey ? ownErrorAt.error : null;
  const setOwnError = React.useCallback((error: PreviewError | null) => setOwnErrorAt(error ? { key: buildKey, error } : null), [buildKey]);
  // The visual check captures from inside Sandpack's frame. On the own build there is nothing to
  // wait for, so say so instead of leaving the workspace waiting for a screenshot.
  const skipCapture = React.useRef(onCaptureFailed);
  React.useEffect(() => {
    skipCapture.current = onCaptureFailed;
  }, [onCaptureFailed]);
  React.useEffect(() => {
    if (engine === "own" && checkVersion === version) skipCapture.current?.();
  }, [engine, checkVersion, version]);

  const tabs = (
    <div className="flex rounded-full bg-tint p-1 text-sm" role="tablist" aria-label="View">
      {(["preview", "code", "contract"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={tab === t}
          onClick={() => setTab(t)}
          className={cn(
            "rounded-full px-4 py-1.5 capitalize outline-none focus-visible:shadow-focus",
            tab === t ? "bg-surface font-medium shadow-card" : "text-grey-600 hover:text-violet",
          )}
        >
          {t}
        </button>
      ))}
    </div>
  );

  if (!hasApp) {
    return (
      <section aria-label="Preview" className="flex min-h-0 flex-col rounded-card bg-surface p-3 shadow-card">
        <div className="px-2 py-1">{tabs}</div>
        <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-block bg-canvas p-8 text-center">
          <LogoMark className="size-10 opacity-80" />
          <p className="max-w-xs text-sm text-grey-600">The live preview appears here once the first build finishes.</p>
        </div>
      </section>
    );
  }

  return (
    // Sandpack wraps its children in its own div (styled by unlayered runtime CSS, which beats
    // Tailwind's layered utilities); `.gb-sp-section` in globals.css makes it fill the card.
    <section aria-label="Preview" className="gb-sp-section flex min-h-0 flex-col rounded-card bg-surface p-3 shadow-card">
      <SandpackProvider
        // Remount the bundler on each new version, and when a deploy lands (which adds no version),
        // so the preview always matches the saved files.
        key={buildKey}
        template="react-ts"
        theme={theme}
        files={sandpackFiles}
        customSetup={{ entry: CAPTURE_ENTRY, dependencies: { ...deps, ...CAPTURE_DEPENDENCY } }}
        options={{
          activeFile: "/src/App.tsx",
          visibleFiles: visible,
          externalResources: ["https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"],
          recompileDelay: 400,
        }}
      >
        <Toolbar
          tabs={tabs}
          tab={tab}
          device={device}
          setDevice={setDevice}
          chainId={chainId}
          popoutHref={engine === "own" && ownUrl ? ownUrl : `/p/${projectId}/preview`}
          onRefresh={engine === "own" ? () => setReloads((n) => n + 1) : undefined}
        />
        <div className="gb-sandpack mt-3 min-h-0 flex-1 overflow-hidden rounded-block bg-canvas">
          <div className={cn("h-full", tab !== "preview" && "hidden")}>
            {engine === "own" ? (
              <OwnPreview key={buildKey} projectId={projectId} reloadKey={reloads} device={device} onRuntimeError={onRuntimeError} onError={setOwnError} onUrl={setOwnUrl} />
            ) : (
              <div ref={frameRef} className={cn("relative mx-auto h-full transition-[max-width] duration-200 ease-gb", device === "mobile" ? "max-w-[390px] py-3" : "max-w-none")}>
                <PreviewCover rounded={device === "mobile"} onStuck={sandpackFailed} />
                <SandpackPreview
                  className={cn("!h-full overflow-hidden bg-surface", device === "mobile" ? "rounded-[24px] shadow-card" : "")}
                  showOpenInCodeSandbox={false}
                  showRefreshButton={false}
                  showSandpackErrorOverlay={false}
                />
              </div>
            )}
          </div>
          {tab === "code" && (
            <div className="grid h-full grid-cols-[200px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] bg-surface">
              <SandpackFileExplorer autoHiddenFiles className="!h-full min-h-0 overflow-auto border-r border-hairline text-grey-600" />
              <SandpackCodeEditor readOnly showTabs showLineNumbers showReadOnly={false} className="!h-full min-h-0" />
            </div>
          )}
          {tab === "contract" && <ContractView files={files} solFiles={solFiles} contracts={contracts} />}
        </div>
        {engine === "own" ? (
          ownError && <PreviewErrorNotice error={ownError} onFix={onFix} fixDisabled={fixDisabled} onDismiss={() => setOwnError(null)} />
        ) : (
          <ErrorWatcher onFix={onFix} fixDisabled={fixDisabled} onRuntimeError={onRuntimeError} onInfraError={sandpackFailed} />
        )}
        {engine === "sandpack" && onCaptured && <VisualCheckRunner version={version} checkVersion={checkVersion ?? null} visible={tab === "preview"} container={frameRef} onCaptured={onCaptured} onFailed={onCaptureFailed} />}
      </SandpackProvider>
    </section>
  );
}

/**
 * Sandpack's own loading overlay can stay opaque after the bundler finishes (its listener misses
 * the "done" message in dev), hiding a working preview. It is hidden in globals.css; this cover
 * replaces it and clears on the bundler's raw "done" message, which always arrives.
 */
export function PreviewCover({ rounded, onStuck }: { rounded: boolean; onStuck?: () => void }) {
  const [ready, setReady] = React.useState(false);
  const [slow, setSlow] = React.useState(false);
  const stuck = React.useRef(onStuck);
  React.useEffect(() => {
    stuck.current = onStuck;
  }, [onStuck]);
  React.useEffect(() => {
    let timer = 0;
    let giveUp = 0;
    // The "slow" hint counts from the latest (re)start, not from mount.
    const arm = () => {
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
      setSlow(false);
      timer = window.setTimeout(() => setSlow(true), 45_000);
      // CodeSandbox's bundler hasn't answered (down, or blocked on this network): the workspace
      // switches to GoodBuild's own build instead of leaving the person waiting (D69).
      giveUp = window.setTimeout(() => stuck.current?.(), SANDPACK_STUCK_MS);
    };
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { codesandbox?: boolean; type?: string; firstLoad?: boolean } | null;
      if (!d || typeof d !== "object" || !d.codesandbox) return;
      if (d.type === "done" || d.type === "success") {
        window.clearTimeout(timer);
        window.clearTimeout(giveUp);
        setReady(true);
      } else if (d.type === "start" && d.firstLoad) {
        setReady(false);
        arm();
      }
    };
    window.addEventListener("message", onMessage);
    arm();
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      window.clearTimeout(giveUp);
    };
  }, []);
  if (ready) return null;
  return (
    <div
      className={cn("absolute inset-x-0 z-10 flex flex-col items-center justify-center gap-3 bg-surface p-8 text-center", rounded ? "inset-y-3 rounded-[24px]" : "inset-y-0 rounded-block")}
      role="status"
    >
      <LogoMark className="size-10 animate-pulse opacity-80" />
      <p className="max-w-xs text-sm text-grey-600">
        {slow ? "The preview is slow to start. Use the refresh button above to try again." : "Starting the preview. The first load can take a few seconds."}
      </p>
    </div>
  );
}

function Toolbar({
  tabs,
  tab,
  device,
  setDevice,
  chainId,
  popoutHref,
  onRefresh,
}: {
  tabs: React.ReactNode;
  tab: Tab;
  device: "desktop" | "mobile";
  setDevice: (d: "desktop" | "mobile") => void;
  chainId: number;
  popoutHref: string;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2 py-1">
      {tabs}
      <div className={cn("flex items-center gap-2 text-sm text-grey-600", tab !== "preview" && "invisible")}>
        <span className="hidden rounded-full bg-canvas px-3 py-1.5 font-mono text-xs sm:inline">preview · {chainLabel(chainId)}</span>
        <a
          href={popoutHref}
          target="_blank"
          rel="noopener"
          aria-label="Open preview in a new tab"
          title="Open preview in a new tab"
          className="grid size-8 place-items-center rounded-full bg-canvas outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
        >
          <ExternalLink className="size-3.5" />
        </a>
        <PreviewControls device={device} setDevice={setDevice} onRefresh={onRefresh} />
      </div>
    </div>
  );
}

/** Refresh and the device toggle, shared by the workspace toolbar and the pop-out tab. */
export function PreviewControls({ device, setDevice, onRefresh }: { device: "desktop" | "mobile"; setDevice: (d: "desktop" | "mobile") => void; onRefresh?: () => void }) {
  const sandpack = useSandpackNavigation();
  const refresh = onRefresh ?? sandpack.refresh;
  return (
    <>
      <button
        type="button"
        onClick={() => refresh()}
        aria-label="Refresh preview"
        className="grid size-8 place-items-center rounded-full bg-canvas outline-none hover:bg-tint hover:text-violet focus-visible:shadow-focus"
      >
        <RotateCw className="size-3.5" />
      </button>
      <div className="flex rounded-full bg-canvas p-1" role="radiogroup" aria-label="Device">
        {(["desktop", "mobile"] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={device === d}
            aria-label={d === "desktop" ? "Desktop" : "Mobile"}
            onClick={() => setDevice(d)}
            className={cn("rounded-full px-2.5 py-1 outline-none focus-visible:shadow-focus", device === d && "bg-surface shadow-card")}
          >
            {d === "desktop" ? <Monitor className="size-3.5" /> : <Smartphone className="size-3.5" />}
          </button>
        ))}
      </div>
    </>
  );
}

/** Sandpack compile and runtime errors, with a "Fix it" that sends them to the agent (AI_AGENT.md §7). */
/**
 * The visual check (P17): once the bundle for the version just built renders without an error,
 * wait for it to settle, capture it from inside the iframe (preview-capture.ts) and hand the PNG
 * to the workspace, which asks the vision model for visible defects. Once per version.
 */
function VisualCheckRunner({
  version,
  checkVersion,
  visible,
  container,
  onCaptured,
  onFailed,
}: {
  version: number;
  checkVersion: number | null;
  visible: boolean;
  container: React.RefObject<HTMLDivElement | null>;
  onCaptured: (shot: { url: string; width: number }, version: number) => void;
  onFailed?: () => void;
}) {
  const { listen } = useSandpack();
  const [rendered, setRendered] = React.useState(false);
  const done = React.useRef<number | null>(null);
  const captured = React.useRef(onCaptured);
  const failed = React.useRef(onFailed);
  React.useEffect(() => {
    captured.current = onCaptured;
    failed.current = onFailed;
  }, [onCaptured, onFailed]);

  React.useEffect(
    () =>
      listen((msg) => {
        if (msg.type === "action" && msg.action === "show-error") setRendered(false);
        else if (msg.type === "success" || (msg.type === "done" && !(msg as { compilatonError?: boolean }).compilatonError)) setRendered(true);
      }),
    [listen],
  );

  React.useEffect(() => {
    if (!rendered || !visible || checkVersion !== version || done.current === version) return;
    const timer = window.setTimeout(() => {
      const iframe = container.current?.querySelector<HTMLIFrameElement>("iframe");
      if (!iframe || iframe.clientWidth < 200) return;
      done.current = version;
      capturePreview(iframe)
        .then((shot) => captured.current({ url: shot.url, width: shot.width }, version))
        .catch(() => failed.current?.());
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [rendered, visible, checkVersion, version, container]);
  return null;
}

function ErrorWatcher({
  onFix,
  fixDisabled,
  onRuntimeError,
  onInfraError,
}: {
  onFix: (prompt: string) => void;
  fixDisabled: boolean;
  /** Called once per error shown; the workspace decides whether to auto-fix. */
  onRuntimeError?: (error: PreviewError) => void;
  /** The bundler or a CDN failed, not the app: the workspace switches to its own build. */
  onInfraError?: () => void;
}) {
  const { listen } = useSandpack();
  const infra = React.useRef(onInfraError);
  React.useEffect(() => {
    infra.current = onInfraError;
  }, [onInfraError]);
  const [error, setError] = React.useState<PreviewError | null>(null);
  const report = React.useRef(onRuntimeError);
  React.useEffect(() => {
    report.current = onRuntimeError;
  }, [onRuntimeError]);

  React.useEffect(() => {
    return listen((msg) => {
      if (msg.type === "action" && msg.action === "show-error") {
        const m = msg as unknown as PreviewError;
        const e = { title: m.title, message: m.message, path: m.path, line: m.line };
        setError(e);
        if (isInfraError(e)) infra.current?.();
        else report.current?.(e);
      } else if (msg.type === "success") {
        setError(null);
      }
    });
  }, [listen]);

  if (!error) return null;
  return <PreviewErrorNotice error={error} onFix={onFix} fixDisabled={fixDisabled} onDismiss={() => setError(null)} />;
}

function ContractView({
  files,
  solFiles,
  contracts,
}: {
  files: Record<string, string>;
  solFiles: string[];
  contracts: Array<{ name: string; file: string; bytecodeBytes: number }>;
}) {
  const [active, setActive] = React.useState(solFiles[0]);
  const current = solFiles.includes(active) ? active : solFiles[0];
  if (!current) {
    return <p className="grid h-full place-items-center p-8 text-sm text-grey-600">No contract yet. Ask for one in the chat.</p>;
  }
  const compiled = contracts.filter((c) => c.file === current);
  const lines = (files[current] ?? "").split("\n");
  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
        <div className="flex gap-1">
          {solFiles.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setActive(f)}
              className={cn("rounded-full px-3 py-1 font-mono text-xs", f === current ? "bg-tint text-violet" : "text-grey-600 hover:text-violet")}
            >
              {f.replace("contracts/", "")}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs">
          {compiled.map((c) => (
            <span key={c.name} className="rounded-full bg-canvas px-2.5 py-1 text-grey-600">
              {c.name} · {(c.bytecodeBytes / 1024).toFixed(1)} kB
            </span>
          ))}
          <span
            className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 font-medium text-warning"
            title="Generated code built on audited OpenZeppelin contracts. It hasn't been audited itself; review it before using real funds."
          >
            <ShieldAlert className="size-3.5" /> Unaudited
          </span>
        </div>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto py-3 font-mono text-[13px] leading-5">
        {lines.map((l, i) => (
          <span key={i} className="flex">
            <span className="w-12 shrink-0 pr-4 text-right text-grey-400 select-none">{i + 1}</span>
            <span className="whitespace-pre">{l}</span>
          </span>
        ))}
      </pre>
    </div>
  );
}
