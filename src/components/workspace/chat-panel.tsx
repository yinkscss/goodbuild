"use client";

import * as React from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";

import { formatCredits } from "@/lib/credits-math";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { nextQuestion, PLAN_OTHER_MAX, planBuildPrompt, START_BUILDING_TEXT } from "@/lib/plan";
import { TopUpPill } from "@/components/credits/top-up-pill";
import { FIX_PROMPT } from "@/lib/preview-errors";
import { isSubmitShortcut } from "@/lib/prompt";
import { isNearBottom } from "@/lib/scroll";
import type { TurnMode, TurnRecord } from "@/lib/turn-types";
import { cn } from "@/lib/utils";
import { DeployButton } from "@/components/deploy/deploy-trigger";
import { AssetBar, AttachMenu, imageFiles } from "./asset-bar";
import { hasMiniPayKit } from "@/lib/minipay-checklist";
import { FirstWait } from "./first-wait";
import { MiniPayGuide } from "./minipay-guide";
import { OldFundsCard } from "./old-funds-card";
import { TurnView } from "./turn-view";
import type { PublishInfo } from "./use-publish";
import type { UseWorkspace } from "./use-workspace";
import { VerifyCard } from "./verify-card";
import { TemplateBanner } from "@/components/landing/template-slides";

/** Left pane of the workspace (mockup c): the conversation and the composer. */
export function ChatPanel({
  ws,
  assetUrls = {},
  publish = null,
  onPublish,
}: {
  ws: UseWorkspace;
  assetUrls?: Record<string, string>;
  /** Publish status, for the MiniPay guide (D88). */
  publish?: PublishInfo | null;
  onPublish?: () => void;
}) {
  const { state, live, running, send } = ws;
  // Behind a proxy (D33), new code arrives at the same address: no "new contract" warning belongs here.
  const sameAddress = state.outdatedContracts.length > 0 && state.outdatedContracts.every((name) => state.upgradableContracts.includes(name));
  const endRef = React.useRef<HTMLDivElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  // Follow the build only while the person is at the bottom. Someone who scrolled up to read an
  // earlier reply stays where they are while steps keep arriving.
  const following = React.useRef(true);
  const onListScroll = () => {
    const el = listRef.current;
    if (el) following.current = isNearBottom(el);
  };

  // A message was added (theirs, or a reply starting): go to it wherever they were.
  React.useEffect(() => {
    following.current = true;
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [state.messages.length]);
  React.useEffect(() => {
    if (following.current) endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [live?.text, live?.record.steps.length, live?.record.log.length]);

  const liveMessageId = live?.messageId;
  // Chips only on the newest assistant turn, and not while another turn runs or waits.
  const lastAssistantId = [...state.messages].reverse().find((m) => m.role === "assistant")?.id;
  const suggest = (prompt: string) => send(prompt, "build");
  const canSuggest = !running;
  // The running turn is writing the plan's questions: "Skip" is offered there too.
  const planning = (state.messages.find((m) => m.id === state.jobs[0]?.userMessageId)?.meta as { intake?: boolean } | null)?.intake === true;
  const lastRecord = state.messages.find((m) => m.id === lastAssistantId)?.meta as TurnRecord | null | undefined;
  // The prompt the newest turn answered, for "Try again" on a failed or interrupted build.
  // The newest reply's questions are still open: a typed answer in the composer answers the next one.
  const openIntake = lastRecord?.intake && !running && !state.project.currentVersion ? lastRecord.intake : null;
  const openQuestion = openIntake ? openIntake.questions[nextQuestion(openIntake)] : undefined;
  const onComposerSend = (prompt: string, mode: TurnMode) => {
    const text = prompt.trim();
    if (lastAssistantId && openQuestion && mode === "build" && text.length <= PLAN_OTHER_MAX) ws.answerPlan(lastAssistantId, openQuestion.id, { picks: [], other: text });
    else send(prompt, mode);
  };
  // "Change something" on a drafted plan: the composer, in Plan mode, with the cursor in it.
  const [composerCue, setComposerCue] = React.useState(0);
  const draftOpen = Boolean(lastRecord?.mode === "plan" && lastRecord.plan && !lastRecord.intake && !running);
  const lastUserPrompt = [...state.messages].reverse().find((m) => m.role === "user" && m.status !== "queued" && m.status !== "cancelled")?.content;
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col rounded-card bg-surface shadow-card">
      <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-5" aria-live="polite">
        <TemplateBanner templateId={state.project.templateId} />
        {state.messages.map((m) => {
          if (m.id === liveMessageId) return null;
          if (m.role === "user") {
            const mode = (m.meta as { mode?: TurnMode } | null)?.mode ?? "build";
            const waiting = m.status === "queued" && state.jobs.findIndex((j) => j.userMessageId === m.id) !== 0;
            const cancelled = m.status === "cancelled";
            return (
              <div key={m.id} className={cn("flex flex-col items-end gap-1", (waiting || cancelled) && "opacity-60")}>
                <p className="max-w-[90%] rounded-block rounded-br-md break-words bg-tint px-4 py-3 text-sm whitespace-pre-wrap">{m.content}</p>
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
              draft={
                m.id === lastAssistantId && !running && record.plan
                  ? { build: () => send(planBuildPrompt(record.plan!), "build", { skipPlan: true }), change: () => setComposerCue((n) => n + 1) }
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
          <FirstWait ahead={Math.max(0, state.jobs.findIndex((j) => j.userMessageId === state.messages.at(-1)?.id))} />
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
        {/* A MiniPay app (D88): deploy, publish, then the steps to open it in MiniPay. */}
        {hasMiniPayKit(state.files) && state.project.currentVersion > 0 && !running && onPublish && (
          <MiniPayGuide
            projectId={state.project.id}
            chainId={state.project.chainId}
            files={state.files}
            hasContracts={Object.keys(state.files).some((p) => p.startsWith("contracts/") && p.endsWith(".sol") && !p.startsWith("contracts/test/"))}
            outdatedContracts={state.outdatedContracts}
            publish={publish}
            onPublish={onPublish}
            onAsk={suggest}
            busy={running}
          />
        )}
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
        onSend={onComposerSend}
        onStop={ws.stop}
        focusCue={composerCue}
        placeholder={
          openQuestion
            ? "Or type your own answer here."
            : lastRecord?.intake && !state.project.currentVersion
              ? "Or type what you want here. Sending starts the build."
              : draftOpen
                ? 'Say what to change, e.g. "make it weekly"'
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
  focusCue = 0,
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
  /** Each increase puts the cursor in the box and switches to Plan mode (a drafted plan's "Change something"). */
  focusCue?: number;
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

  // A new cue switches to Plan mode while rendering (not in an effect), then the cursor goes in the box.
  const [seenCue, setSeenCue] = React.useState(focusCue);
  if (focusCue !== seenCue) {
    setSeenCue(focusCue);
    setMode("plan");
  }
  React.useEffect(() => {
    if (focusCue) ref.current?.focus();
  }, [focusCue]);

  function submit() {
    if (!value.trim()) return;
    onSend(value, mode);
    setValue("");
  }

  const est = mode === "plan" ? estimate.planMicro : estimate.buildMicro;
  const [dragging, setDragging] = React.useState(false);
  return (
    <form
      className={cn("m-3 mt-0 rounded-block sm:m-4 sm:mt-0 bg-canvas p-3 focus-within:shadow-focus", dragging && "shadow-focus")}
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
          if (isSubmitShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, isComposing: e.nativeEvent.isComposing })) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="block w-full resize-none bg-transparent px-1 text-sm leading-[22px] outline-none placeholder:text-grey-400 focus-visible:shadow-none"
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
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
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          <span className="text-xs text-grey-400" title="Estimated charge for this request: AI cost + 25%. Each new account gets 20 credits of AI free.">
            ≈ {formatCredits(est)} {running ? "· runs after this build" : ""}
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
