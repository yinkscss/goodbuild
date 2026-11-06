"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ChevronDown, History } from "lucide-react";

import { WalletButton } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { DeployButton, DeployProvider } from "@/components/deploy/deploy-trigger";
import { contractAddressKey, contractsToWire, deployedContracts, wirePrompt } from "@/lib/deploy/wiring";
import { CreditsPill } from "@/components/home/credits-pill";
import { NetworkBadge } from "@/components/home/top-bar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { relativeTime } from "@/lib/home";
import type { TurnRecord } from "@/lib/turn-types";
import { openPreviewChannel, type PreviewChannelMessage } from "@/lib/preview-channel";
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "@/server/workspace-state";
import { ChatPanel } from "./chat-panel";
import { BackendButton, BackendModal, backendState } from "./backend-modal";
import { PublishButton, PublishModal } from "./publish-modal";
import { usePublish } from "./use-publish";
import { useAssetDataUrls, useWorkspace } from "./use-workspace";

// Sandpack is browser-only and heavy: load it on the client.
const PreviewPanel = dynamic(() => import("./preview-panel").then((m) => m.PreviewPanel), {
  ssr: false,
  loading: () => <div className="skeleton rounded-card motion-reduce:animate-none" aria-label="Loading preview" />,
});

/** The builder workspace (design/app/c-workspace.html, DESIGN_SYSTEM §4). */
export function Workspace({ initial }: { initial: WorkspaceState }) {
  const ws = useWorkspace(initial);
  const { state, live, running } = ws;
  const [pane, setPane] = React.useState<"chat" | "preview">("chat");

  // Live files during a turn (once it reports them), otherwise the saved files.
  const files = live?.files ?? state.files;
  const assetUrls = useAssetDataUrls(state.project.id, state.assets);
  const latestRecord = [...state.messages].reverse().map((m) => m.meta as TurnRecord | null).find((r) => r?.kind === "turn" && r.contracts?.length);

  const previewVersion = live?.record.version ?? state.project.currentVersion;
  useBroadcastPreview(state.project.id, files, previewVersion);
  const [publishOpen, setPublishOpen] = React.useState(false);
  const [backendOpen, setBackendOpen] = React.useState(false);
  const backendOn = backendState(files).on;
  const publish = usePublish(state.project.id, state.project.currentVersion, publishOpen);

  const hasContracts = Object.keys(files).some((p) => p.startsWith("contracts/") && p.endsWith(".sol") && !p.startsWith("contracts/test/"));

  const addressKey = contractAddressKey(files);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- files change on every keystroke of a live turn; addresses rarely do
  const deployed = React.useMemo(() => deployedContracts(files, state.project.chainId), [addressKey, state.project.chainId]);

  return (
    <DeployProvider
      projectId={state.project.id}
      chainId={state.project.chainId}
      hasContracts={hasContracts}
      deployed={deployed.filter((name) => !state.outdatedContracts.includes(name))}
      busy={running}
      onDeployed={(deployed) => {
        void ws.refresh().then((next) => {
          const toWire = next ? contractsToWire(next.files, deployed) : [];
          if (toWire.length) ws.send(wirePrompt(toWire), "build");
        });
      }}
      onFix={(prompt) => ws.send(prompt, "build")}
      onPublish={() => setPublishOpen(true)}
    >
    <div className="flex h-dvh flex-col gap-4 p-4">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-3">
          <Logo href="/home" wordmarkClassName="hidden sm:inline" />
          <span className="hidden text-grey-400 sm:inline" aria-hidden>
            /
          </span>
          <h1 className="hidden truncate font-semibold sm:block">{state.project.name}</h1>
          <VersionMenu ws={ws} />
        </div>
        <div className="flex items-center gap-3">
          <CreditsPill balanceGd={null} usdPerGd={null} className="hidden xl:flex" />
          <NetworkBadge />
          <BackendButton on={backendOn} disabled={running} onOpen={() => setBackendOpen(true)} compact className="hidden px-3.5 py-2.5 md:inline-flex 2xl:px-5" />
          <PublishButton publish={publish} onOpen={() => setPublishOpen(true)} disabled={running} className="hidden px-5 py-2.5 md:inline-flex" />
          <DeployButton className="hidden px-5 py-2.5 md:inline-flex" />
          <WalletButton showNetwork={false} />
        </div>
      </header>

      {/* The header can't fit these on a phone, and MiniPay users are on phones. */}
      <div className="flex gap-2 md:hidden">
        <BackendButton on={backendOn} disabled={running} onOpen={() => setBackendOpen(true)} className="flex-1 px-4 py-2.5" />
        <PublishButton publish={publish} onOpen={() => setPublishOpen(true)} disabled={running} className="flex-1 px-4 py-2.5" />
        <DeployButton className="flex-1 px-4 py-2.5" />
      </div>

      <div className="flex rounded-full bg-tint p-1 text-sm lg:hidden" role="tablist" aria-label="Pane">
        {(["chat", "preview"] as const).map((p) => (
          <button
            key={p}
            type="button"
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn("flex-1 rounded-full py-1.5 capitalize", pane === p ? "bg-surface font-medium shadow-card" : "text-grey-600")}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className={cn("min-h-0 flex-col", pane === "chat" ? "flex" : "hidden lg:flex", "[&>*]:flex-1")}>
          <ChatPanel ws={ws} assetUrls={assetUrls} />
        </div>
        <div className={cn("min-h-0 flex-col", pane === "preview" ? "flex" : "hidden lg:flex", "[&>*]:flex-1")}>
          <PreviewPanel
            projectId={state.project.id}
            files={files}
            assetUrls={assetUrls}
            version={previewVersion}
            contracts={latestRecord?.contracts ?? []}
            onFix={(prompt) => ws.send(prompt, "build")}
            onRuntimeError={(e) => ws.onPreviewError(e, live?.record.version ?? state.project.currentVersion)}
            checkVersion={live ? null : ws.checkVersion}
            onCaptured={(shot, v) => void ws.onPreviewCaptured(shot, v)}
            onCaptureFailed={ws.onCaptureFailed}
            fixDisabled={running}
          />
        </div>
      </div>
      <BackendModal
        open={backendOpen}
        onOpenChange={setBackendOpen}
        projectId={state.project.id}
        project={{ name: state.project.name }}
        files={files}
        published={Boolean(publish.info?.live)}
        busy={running}
        onSend={(prompt) => ws.send(prompt, "build")}
      />
      <PublishModal open={publishOpen} onOpenChange={setPublishOpen} publish={publish} projectBusy={running} onFix={(prompt) => ws.send(prompt, "build")} />
    </div>
    </DeployProvider>
  );
}

/** Keeps pop-out preview tabs on what this tab is showing, including live files during a build. */
function useBroadcastPreview(projectId: string, files: Record<string, string>, version: number) {
  const channel = React.useRef<BroadcastChannel | null>(null);
  const latest = React.useRef<PreviewChannelMessage>({ type: "files", files, version });

  React.useEffect(() => {
    const ch = openPreviewChannel(projectId);
    if (!ch) return;
    channel.current = ch;
    // A pop-out that just opened asks for the current state.
    ch.onmessage = (e: MessageEvent<PreviewChannelMessage>) => {
      if (e.data?.type === "hello") ch.postMessage(latest.current);
    };
    return () => {
      channel.current = null;
      ch.close();
    };
  }, [projectId]);

  React.useEffect(() => {
    latest.current = { type: "files", files, version };
    channel.current?.postMessage(latest.current);
  }, [files, version]);
}

function VersionMenu({ ws }: { ws: ReturnType<typeof useWorkspace> }) {
  const { state, running } = ws;
  const current = state.project.currentVersion;
  const label = running ? "building…" : current ? `v${current}` : "new";
  const suffix = !running && current ? " · auto-saved" : "";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-full bg-tint px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap text-violet outline-none hover:bg-violet-soft focus-visible:shadow-focus"
          disabled={!state.versions.length}
          aria-label="Versions"
        >
          {label}
          <span className="hidden sm:inline">{suffix}</span>
          {state.versions.length > 0 && <ChevronDown className="size-3" />}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Versions</DropdownMenuLabel>
        {state.versions.slice(0, 12).map((v) => (
          <DropdownMenuItem
            key={v.number}
            disabled={running || v.number === current}
            onSelect={() => {
              if (window.confirm(`Revert to v${v.number}? Your files go back to that version. The chat and any deployed contracts stay as they are.`)) {
                void ws.revert(v.number);
              }
            }}
          >
            <History className="mt-0.5 size-4 text-grey-600" />
            <span className="min-w-0">
              <span className="block font-medium">
                v{v.number}
                {v.number === current && <span className="ml-1.5 text-xs font-normal text-grey-600">current</span>}
              </span>
              <span className="block truncate text-xs text-grey-600">
                {v.summary} · {relativeTime(new Date(v.createdAt))}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <p className="px-3 py-2 text-[11px] text-grey-600">Reverting never changes contracts you&apos;ve deployed.</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
