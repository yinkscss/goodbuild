"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { ChevronDown, History } from "lucide-react";

import { WalletButton } from "@/components/auth/wallet-button";
import { Logo } from "@/components/brand/logo";
import { CreditsPill } from "@/components/home/credits-pill";
import { NetworkBadge } from "@/components/home/top-bar";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import type { WorkspaceState } from "@/server/workspace-state";
import { ChatPanel } from "./chat-panel";
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

  return (
    <div className="flex h-dvh flex-col gap-4 p-4">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-2">
        <div className="flex min-w-0 items-center gap-3">
          <Logo href="/home" />
          <span className="hidden text-grey-400 sm:inline" aria-hidden>
            /
          </span>
          <h1 className="hidden truncate font-semibold sm:block">{state.project.name}</h1>
          <VersionMenu ws={ws} />
        </div>
        <div className="flex items-center gap-3">
          <CreditsPill balanceGd={null} usdPerGd={null} className="hidden xl:flex" />
          <NetworkBadge />
          <Button variant="primary" className="hidden px-5 py-2.5 md:inline-flex" disabled title="Wallet-signed deploys are coming in the next update">
            Deploy
          </Button>
          <WalletButton showNetwork={false} />
        </div>
      </header>

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

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[420px_minmax(0,1fr)] xl:grid-cols-[460px_minmax(0,1fr)]">
        <div className={cn("min-h-0 flex-col", pane === "chat" ? "flex" : "hidden lg:flex", "[&>*]:flex-1")}>
          <ChatPanel ws={ws} assetUrls={assetUrls} />
        </div>
        <div className={cn("min-h-0 flex-col", pane === "preview" ? "flex" : "hidden lg:flex", "[&>*]:flex-1")}>
          <PreviewPanel
            files={files}
            assetUrls={assetUrls}
            version={live?.record.version ?? state.project.currentVersion}
            contracts={latestRecord?.contracts ?? []}
            onFix={(prompt) => ws.send(prompt, "build")}
            fixDisabled={running}
          />
        </div>
      </div>
    </div>
  );
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
