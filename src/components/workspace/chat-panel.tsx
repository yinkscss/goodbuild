"use client";

import * as React from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";

import { formatMicroUsd } from "@/lib/pricing";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { START_BUILDING_TEXT } from "@/lib/plan";
import { TopUpPill } from "@/components/credits/top-up-pill";
import { FIX_PROMPT } from "@/lib/preview-errors";
import { isSubmitShortcut } from "@/lib/prompt";
import type { TurnMode, TurnRecord } from "@/lib/turn-types";
import { cn } from "@/lib/utils";
import { DeployButton } from "@/components/deploy/deploy-trigger";
import { AssetBar, AttachMenu, imageFiles } from "./asset-bar";
import { OldFundsCard } from "./old-funds-card";
import { TurnView } from "./turn-view";
import type { UseWorkspace } from "./use-workspace";
import { VerifyCard } from "./verify-card";
import { TemplateBanner } from "@/components/landing/template-slides";

/** Left pane of the workspace (mockup c): the conversation and the composer. */
export function ChatPanel({ ws, assetUrls = {} }: { ws: UseWorkspace; assetUrls?: Record<string, string> }) {
  const { state, live, running, send } = ws;
  // Behind a proxy (D33), new code arrives at the same address: no "new contract" warning belongs here.
  const sameAddress = state.outdatedContracts.length > 0 && state.outdatedContracts.every((name) => state.upgradableContracts.includes(name));
  const endRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.messages.length, live?.text, live?.record.steps.length, live?.record.log.length]);

  const liveMessageId = live?.messageId;
  // Chips only on the newest assistant turn, and not while another turn runs or waits.
  const lastAssistantId = [...state.messages].reverse().find((m) => m.role === "assistant")?.id;
  const suggest = (prompt: string) => send(prompt, "build");
  const canSuggest = !running;
  // The running turn is writing the plan's questions: "Skip" is offered there too.
  const planning = (state.messages.find((m) => m.id === state.jobs[0]?.userMessageId)?.meta as { intake?: boolean } | null)?.intake === true;
  const lastRecord = state.messages.find((m) => m.id === lastAssistantId)?.meta as TurnRecord | null | undefined;
  // The prompt the newest turn answered, for "Try again" on a failed or interrupted build.
  const lastUserPrompt = [...state.messages].reverse().find((m) => m.role === "user" && m.status !== "queued" && m.status !== "cancelled")?.content;
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col rounded-card bg-surface shadow-card">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite">
        <TemplateBanner templateId={state.project.templateId} />
        {state.messages.map((m) => {
          if (m.id === liveMessageId) return null;
          if (m.role === "user") {
            const mode = (m.meta as { mode?: TurnMode } | null)?.mode ?? "build";
            const waiting = m.status === "queued" && state.jobs.findIndex((j) => j.userMessageId === m.id) !== 0;
            const cancelled = m.status === "cancelled";
            return (
              <div key={m.id} className={cn("flex flex-col items-end gap-1", (waiting || cancelled) && "opacity-60")}>
                <p className="max-w-[85%] rounded-block rounded-br-md bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{m.content}</p>
                {mode === "plan" && <span className="text-[11px] text-grey-400">Plan mode</span>}
                {waiting && <span className="text-[11px] text-grey-400">Queued, runs after the current build</span>}
                {cancelled && (
                  <span className="flex items-center gap-2 text-[11px] text-grey-400">
                    Cancelled
                    <button type="button" className="font-medium text-violet hover:underline" onClick={() => send(m.content, mode)}>
                      Resend
                    </button>
                  </span>
                )}
              </div>
            );
          }
          if (m.role === "system") {
            return (
              <p key={m.id} className="text-center text-xs text-grey-600">
                {m.content}
              </p>
            );
          }
          const record = m.meta as TurnRecord | null;
          if (!record || record.kind !== "turn") return <p key={m.id} className="text-sm">{m.content}</p>;
          if (m.status === "streaming") {
            // The live view replaces this as soon as the job's events stream in.
            return (
              <p key={m.id} className="flex items-center gap-2 text-sm text-grey-600">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Working…
              </p>
            );
          }
          return (
            <TurnView
              key={m.id}
              text={m.content}
              record={record}
              chainId={state.project.chainId}
              live={false}
              onFix={() => send(record.status === "error" && lastUserPrompt && m.id === lastAssistantId ? lastUserPrompt : FIX_PROMPT, "build")}
              fixDisabled={running}
              onSuggest={!live && canSuggest && m.id === lastAssistantId ? suggest : undefined}
              checking={m.id === lastAssistantId && ws.checking}
              checkFailed={m.id === lastAssistantId && ws.checkFailed}
              plan={
                m.id === lastAssistantId && !running
                  ? { answer: (q, a) => ws.answerPlan(m.id, q, a), start: () => send(START_BUILDING_TEXT, "build"), skip: ws.skipPlan }
                  : undefined
              }
            />
          );
        })}
        {live && (
          <TurnView
            text={live.text}
            record={live.record}
            chainId={state.project.chainId}
            live={live.phase === "running"}
            onFix={() => send(FIX_PROMPT, "build")}
            fixDisabled={live.phase === "running"}
            onSuggest={live.phase === "done" && state.jobs.length <= 1 ? suggest : undefined}
            onSkipPlan={live.phase === "running" && !live.record.intake && planning ? ws.skipPlan : undefined}
          />
        )}
        {!live && !ws.error && state.messages.at(-1)?.role === "user" && (
          <p className="flex items-center gap-2 text-sm text-grey-600" role="status">
            <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Getting started…
          </p>
        )}
        {ws.error && (
          <p className="flex items-start gap-2 rounded-block bg-canvas px-4 py-3 text-sm" role="alert">
            <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
            {ws.error}
          </p>
        )}
        {ws.needsCredits && (
          <TopUpPill
            onPaid={() => {
              ws.clearNeedsCredits();
              if (lastUserPrompt) send(lastUserPrompt, "build");
            }}
          />
        )}
        {state.outdatedContracts.length > 0 && !running && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-block bg-warning/10 p-4 text-sm" role="status">
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{state.outdatedContracts.join(", ")} {state.outdatedContracts.length > 1 ? "don't" : "doesn't"} have your latest contract changes yet.</span>{" "}
              <span className="text-grey-600">{sameAddress ? "Upgrade from your wallet to apply them. The address, funds and data stay the same." : "Your app keeps using the live version until you deploy again."}</span>
            </p>
            <DeployButton label={sameAddress ? "Upgrade" : "Deploy again"} size="sm" />
          </div>
        )}
        <OldFundsCard projectId={state.project.id} chainId={state.project.chainId} refreshKey={state.project.currentVersion} busy={running} onAsk={suggest} />
        {state.offerVerification && !running && <VerifyCard onVerified={ws.refresh} />}
        <div ref={endRef} />
      </div>
      <Composer
        assets={state.assets}
        assetUrls={assetUrls}
        onUpload={ws.upload}
        onRemove={ws.removeAsset}
        onChangeKind={ws.changeAssetKind}
        uploading={ws.uploading}
        running={running}
        estimate={state.estimate}
        onSend={send}
        onStop={ws.stop}
        placeholder={
          lastRecord?.intake && !state.project.currentVersion
            ? "Or type what you want here. Sending starts the build."
            : state.messages.length
              ? 'Ask for a change… e.g. "let members vote to skip a week"'
              : "Describe the dApp you want to build…"
        }
      />
    </section>
  );
}

export function Composer({
  assets,
  assetUrls,
  onUpload,
  onRemove,
  onChangeKind,
  uploading,
  running,
  estimate,
  onSend,
  onStop,
  placeholder,
}: {
  assets: AssetInfo[];
  assetUrls: Record<string, string>;
  onUpload: (file: File, kind: AssetKind) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onChangeKind: (id: string, kind: AssetKind) => Promise<void>;
  uploading: boolean;
  running: boolean;
  estimate: { buildMicro: number; planMicro: number };
  onSend: (prompt: string, mode: TurnMode) => void;
  onStop?: () => Promise<void>;
  placeholder: string;
}) {
  const [value, setValue] = React.useState("");
  const [mode, setMode] = React.useState<TurnMode>("build");
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 6 * 22 + 8)}px`;
  }, [value]);

  function submit() {
    if (!value.trim()) return;
    onSend(value, mode);
    setValue("");
  }

  const est = mode === "plan" ? estimate.planMicro : estimate.buildMicro;
  const [dragging, setDragging] = React.useState(false);
  return (
    <form
      className={cn("m-4 mt-0 rounded-block bg-canvas p-3 focus-within:shadow-focus", dragging && "shadow-focus")}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      // Drop or paste an image: uploaded as an image; its chip menu changes it to a logo or reference.
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        const files = imageFiles(e.dataTransfer.files);
        setDragging(false);
        if (!files.length) return;
        e.preventDefault();
        for (const f of files) void onUpload(f, "image");
      }}
    >
      <AssetBar assets={assets} assetUrls={assetUrls} onRemove={(id) => void onRemove(id)} onChangeKind={(id, k) => void onChangeKind(id, k)} />
      <label htmlFor="composer" className="sr-only">
        Message GoodBuild
      </label>
      <textarea
        id="composer"
        ref={ref}
        rows={1}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onPaste={(e) => {
          const files = imageFiles(e.clipboardData.files);
          if (!files.length) return;
          e.preventDefault();
          for (const f of files) void onUpload(f, "image");
        }}
        onKeyDown={(e) => {
          if (isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, isComposing: e.nativeEvent.isComposing })) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-1 text-sm leading-[22px] outline-none placeholder:text-grey-400 focus-visible:shadow-none"
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
        <AttachMenu onUpload={(f, k) => void onUpload(f, k)} uploading={uploading} />
        <div className="flex rounded-full bg-surface p-1 text-xs font-medium" role="radiogroup" aria-label="Mode">
          {(["build", "plan"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              title={m === "plan" ? "Plan mode answers and drafts a plan without changing files" : "Build mode changes your app"}
              className={cn(
                "rounded-full px-3 py-1 capitalize outline-none focus-visible:shadow-focus",
                mode === m ? "bg-violet text-white" : "text-grey-600 hover:text-violet",
              )}
            >
              {m}
            </button>
          ))}
        </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-grey-400" title="Estimated charge for this request: AI cost + 25%. Each new account gets $0.20 of AI free during the testnet beta.">
            ≈ {formatMicroUsd(est)} {running ? "· runs after this build" : ""}
          </span>
          {running && onStop && (
            // Secondary pill (DESIGN_SYSTEM §3): white, shadow-card, no border.
            <button
              type="button"
              onClick={() => void onStop()}
              aria-label="Stop the build"
              title="Stop this build (its edits are discarded) and cancel queued messages"
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-surface px-3.5 text-xs font-medium text-ink shadow-card outline-none hover:text-violet focus-visible:shadow-focus"
            >
              <Square className="size-3 fill-current" aria-hidden />
              Stop
            </button>
          )}
          <button
            type="submit"
            disabled={!value.trim()}
            aria-label={running ? "Queue message" : "Send"}
            className="grid size-9 place-items-center rounded-full bg-violet text-white outline-none hover:bg-violet/92 focus-visible:shadow-focus disabled:opacity-55"
          >
            <ArrowUp className="size-4" strokeWidth={2.5} />
          </button>
        </div>
      </div>
    </form>
  );
}
