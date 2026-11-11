"use client";

import * as React from "react";
import { SandpackPreview, SandpackProvider } from "@codesandbox/sandpack-react";

import { Logo, LogoMark } from "@/components/brand/logo";
import { contractAddressKey } from "@/lib/deploy/wiring";
import { openPreviewChannel, shouldShowSaved, type PreviewChannelMessage } from "@/lib/preview-channel";
import { TAILWIND_BROWSER_URL } from "@/lib/preview-engine";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "@/server/workspace-state";
import { dependencies, PreviewControls, PreviewCover, theme, toAppFiles } from "./preview-panel";
import { useAssetDataUrls } from "./use-workspace";

/**
 * The preview on its own tab. Leaves out the error watcher and the screenshot helper: the workspace
 * tab owns auto-fixes and visual checks, and a second tab must not trigger them again.
 */
export function PreviewPopout({ initial }: { initial: WorkspaceState }) {
  const projectId = initial.project.id;
  const [files, setFiles] = React.useState(initial.files);
  const [version, setVersion] = React.useState(initial.project.currentVersion);
  const [assets, setAssets] = React.useState(initial.assets);
  const [device, setDevice] = React.useState<"desktop" | "mobile">("desktop");
  const showing = React.useRef({ version, addresses: contractAddressKey(initial.files) });
  const assetUrls = useAssetDataUrls(projectId, assets);

  const show = React.useCallback((next: Record<string, string>, nextVersion: number) => {
    showing.current = { version: nextVersion, addresses: contractAddressKey(next) };
    setFiles(next);
    setVersion(nextVersion);
  }, []);

  React.useEffect(() => {
    const channel = openPreviewChannel(projectId);
    if (!channel) return;
    channel.onmessage = (e: MessageEvent<PreviewChannelMessage>) => {
      if (e.data?.type === "files") show(e.data.files, e.data.version);
    };
    channel.postMessage({ type: "hello" } satisfies PreviewChannelMessage);
    return () => channel.close();
  }, [projectId, show]);

  // The workspace tab may be closed, so catch up from the saved project when this tab regains focus.
  React.useEffect(() => {
    const onFocus = async () => {
      const res = await fetch(`/api/projects/${projectId}`).catch(() => null);
      if (!res?.ok) return;
      const state = (await res.json()) as WorkspaceState;
      setAssets(state.assets);
      const saved = { version: state.project.currentVersion, addresses: contractAddressKey(state.files) };
      if (shouldShowSaved(saved, showing.current)) show(state.files, saved.version);
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [projectId, show]);

  const sandpackFiles = React.useMemo(() => toAppFiles(files, assetUrls), [files, assetUrls]);
  const deps = React.useMemo(() => dependencies(files), [files]);

  if (!("src/App.tsx" in files)) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
        <LogoMark className="size-10 opacity-80" />
        <p className="max-w-xs text-sm text-grey-600">The live preview appears here once the first build finishes.</p>
      </div>
    );
  }

  return (
    <section aria-label="Preview" className="gb-sp-section flex h-dvh flex-col gap-2 p-2">
      <SandpackProvider
        key={`${version}:${contractAddressKey(files)}`}
        template="react-ts"
        theme={theme}
        files={sandpackFiles}
        customSetup={{ entry: "/src/main.tsx", dependencies: deps }}
        options={{ externalResources: [TAILWIND_BROWSER_URL], recompileDelay: 400 }}
      >
        <header className="flex items-center justify-between gap-3 px-2 py-1">
          <div className="flex min-w-0 items-center gap-3">
            <Logo href={`/p/${projectId}`} />
            <h1 className="hidden truncate text-sm font-semibold sm:block">{initial.project.name}</h1>
            {version > 0 && <span className="shrink-0 rounded-full bg-tint px-2.5 py-1 text-[11px] font-semibold text-violet">v{version}</span>}
          </div>
          <div className="flex items-center gap-2 text-sm text-grey-600">
            <PreviewControls device={device} setDevice={setDevice} />
          </div>
        </header>
        <div className="gb-sandpack mt-2 min-h-0 flex-1 overflow-hidden rounded-block bg-canvas">
          <div className={cn("relative mx-auto h-full transition-[max-width] duration-200 ease-gb", device === "mobile" ? "max-w-[390px] py-3" : "max-w-none")}>
            <PreviewCover rounded={device === "mobile"} />
            <SandpackPreview
              className={cn("!h-full overflow-hidden bg-surface", device === "mobile" && "rounded-[24px] shadow-card")}
              showOpenInCodeSandbox={false}
              showRefreshButton={false}
              showSandpackErrorOverlay={false}
            />
          </div>
        </div>
      </SandpackProvider>
    </section>
  );
}
