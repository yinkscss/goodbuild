"use client";

import * as React from "react";
import { ArrowUp, ChevronDown, FileIcon, Loader2, Square } from "lucide-react";

import { formatCredits, formatCreditsShort } from "@/lib/credits-math";
import { isDeployableSource } from "@/lib/deploy/test-file";
import type { AssetInfo, AssetKind } from "@/server/agent/assets";
import { DRAFT_PLAN_TEXT, nextQuestion, PLAN_OTHER_MAX, planBuildPrompt, START_BUILDING_TEXT } from "@/lib/plan";
import { OutOfCredits } from "./out-of-credits";
import { CONTINUE_PROMPT, FIX_PROMPT, previewFixPrompt } from "@/lib/preview-errors";
import { milestoneName } from "@/lib/plain-words";
import { isSubmitShortcut } from "@/lib/prompt";
import { isNearBottom } from "@/lib/scroll";
import type { TurnMode, TurnRecord } from "@/lib/turn-types";
import { cn } from "@/lib/utils";
import { DeployButton } from "@/components/deploy/deploy-trigger";
import { messageAssetIds } from "@/lib/attachments";
import { AssetBar, AttachMenu, imageFiles, KIND_LABEL } from "./asset-bar";
import { hasMiniPayKit } from "@/lib/minipay-checklist";
import { FirstWait } from "./first-wait";
import { MiniPayGuide } from "./minipay-guide";
import { OldFundsCard } from "./old-funds-card";
import { HeldNotice, TurnView } from "./turn-view";
import type { PublishInfo } from "./use-publish";
import type { UseWorkspace } from "./use-workspace";
import { FreeCreditsCard } from "@/components/credits/free-credits-card";
import { VerifyCard } from "./verify-card";
import { TemplateBanner } from "@/components/landing/template-slides";
import type { TurnAction } from "@/lib/turn-actions";

/** What "Fix it for me" (or Continue after a top-up) sends for the newest turn (D164). */
export type RetryRequest = { kind: "job"; jobId: string; useCredits: boolean; note?: string } | { kind: "prompt"; prompt: string; action: TurnAction };

/**
 * One button, one request: continue the failed build from its saved files, carrying the preview's crash, or, with
 * no job to continue, a fix message that names the crash. A build paused for credits continues as it was, without
 * the crash note; after a top-up the retry runs on credits.
 */
export function retryRequest(record: TurnRecord | null | undefined, crash: string | undefined, opts: { afterTopUp?: boolean } = {}): RetryRequest {
  const paused = record?.paused === "credits";
  if (record?.jobId) return { kind: "job", jobId: record.jobId, useCredits: paused || Boolean(opts.afterTopUp), ...(paused || !crash ? {} : { note: crash }) };
  return { kind: "prompt", prompt: paused ? CONTINUE_PROMPT : [FIX_PROMPT, crash].filter(Boolean).join("\n\n"), action: paused ? "resume" : "repair" };
}

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
  const suggest = (prompt: string, action?: TurnAction) => send(prompt, "build", action ? { action } : undefined);
  const canSuggest = !running;
  // The running turn is writing the plan's questions: "Skip" is offered there too.
  const planning = (state.messages.find((m) => m.id === state.jobs[0]?.userMessageId)?.meta as { intake?: boolean } | null)?.intake === true;
  const lastRecord = state.messages.find((m) => m.id === lastAssistantId)?.meta as TurnRecord | null | undefined;
  // The newest reply's questions are still open: a typed answer in the composer answers the next one.
  const openIntake = lastRecord?.intake && !running && (lastRecord.intake.for === "plan" || !state.project.currentVersion) ? lastRecord.intake : null;
  const openQuestion = openIntake ? openIntake.questions[nextQuestion(openIntake)] : undefined;
  const onComposerSend = (prompt: string, mode: TurnMode) => {
    const text = prompt.trim();
    if (lastAssistantId && openQuestion && mode === (openIntake?.for === "plan" ? "plan" : "build") && text.length <= PLAN_OTHER_MAX) ws.answerPlan(lastAssistantId, openQuestion.id, { picks: [], other: text });
    else send(prompt, mode);
  };
  // "Change something" on a drafted plan: the composer, in Plan mode, with the cursor in it.
  const [composerCue, setComposerCue] = React.useState(0);
  const draftOpen = Boolean(lastRecord?.mode === "plan" && lastRecord.plan && !lastRecord.intake && !running);
  // The prompt the newest turn answered, for "Try again" on a failed or interrupted build.
  // D164: one button. It continues from the saved files and carries the preview's crash, if there is one.
  const crash = ws.previewError ? previewFixPrompt(ws.previewError, false) : undefined;
  const runRetry = (r: RetryRequest) => (r.kind === "job" ? ws.retry(r.jobId, r.useCredits, r.note) : send(r.prompt, "build", { action: r.action }));
  const retryRecord = (record?: TurnRecord | null) => runRetry(retryRequest(record, crash));
  // "Undo this change" (D164): the newest finished build, when an earlier version exists to go back to.
  const previousVersion = state.versions.map((v) => v.number).filter((n) => n < state.project.currentVersion).sort((a, b) => b - a)[0];
  const crashWords = ws.previewError ? [ws.previewError.title, ws.previewError.message].filter(Boolean).join(": ") : null;
  const continueAfterCredits = () => {
    ws.clearNeedsCredits();
    const last = [...state.messages].reverse().find((m) => m.role === "assistant");
    const record = last?.meta as TurnRecord | null;
    // After a top-up the retry runs on credits and still carries the preview's crash (D164).
    runRetry(retryRequest(record, crash, { afterTopUp: true }));
  };
  // D177: GoodBuild's AI account is empty and a request is waiting for it, so it starts on its own.
  const holding = Boolean(state.aiPaused) && state.jobs.some((j) => j.status === "queued");
  // The head request hasn't started: show that it's waiting, not a "Thinking" clock running for hours.
  const heldHead = Boolean(live && holding && state.jobs[0]?.status === "queued" && live.record.jobId === state.jobs[0].id && !live.text && !live.record.steps.length);
  const continueCost = { needMicro: state.estimate.buildMicro, haveMicro: state.availableMicro };
  return (
    <section aria-label="Chat" className="flex min-h-0 flex-col rounded-card bg-surface shadow-card">
      <div ref={listRef} onScroll={onListScroll} className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto overscroll-contain p-3 sm:p-5" aria-live="polite">
        <TemplateBanner templateId={state.project.templateId} />
        {state.messages.map((m) => {
          if (m.id === liveMessageId) return null;
          if (m.role === "user" && m.meta?.action === "retry") return <p key={m.id} className="text-xs text-grey-600">Resuming the saved build</p>;
          if (m.role === "user") {
            const mode = (m.meta as { mode?: TurnMode } | null)?.mode ?? "build";
            const waiting = m.status === "queued" && state.jobs.findIndex((j) => j.userMessageId === m.id) !== 0;
            const cancelled = m.status === "cancelled";
            return (
              <div key={m.id} className={cn("flex flex-col items-end gap-1", (waiting || cancelled) && "opacity-60")}>
                <SentFiles ids={messageAssetIds(m.meta)} assets={state.assets} assetUrls={assetUrls} />
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
              onFix={() => retryRecord(record)}
              continueCost={m.id === lastAssistantId ? continueCost : undefined}
              previewError={m.id === lastAssistantId ? crashWords : undefined}
              onUndo={
                m.id === lastAssistantId && !running && record.status === "ready" && record.version === state.project.currentVersion && previousVersion
                  ? () => void ws.revert(previousVersion)
                  : undefined
              }
              fixDisabled={running}
              held={holding && m.id === lastAssistantId}
              onSuggest={!live && canSuggest && m.id === lastAssistantId ? suggest : undefined}
              checking={m.id === lastAssistantId && ws.checking}
              checkFailed={m.id === lastAssistantId ? ws.checkFailed : null}
              plan={
                m.id === lastAssistantId && !running
                  ? record.intake?.for === "plan"
                    ? // Plan mode's questions (D103): the answers start the plan, not the build.
                      { answer: (q, a) => ws.answerPlan(m.id, q, a), start: () => send(DRAFT_PLAN_TEXT, "plan"), skip: () => send(DRAFT_PLAN_TEXT, "plan") }
                    : { answer: (q, a) => ws.answerPlan(m.id, q, a), start: () => send(START_BUILDING_TEXT, "build", { buildFromIntake: true, action: "start_building" }), skip: ws.skipPlan }
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
        {live && heldHead && <HeldNotice />}
        {live && !heldHead && (
          <TurnView
            text={live.text}
            record={live.record}
            chainId={state.project.chainId}
            live={live.phase === "running"}
            onFix={() => retryRecord(live?.record)}
            continueCost={continueCost}
            previewError={crashWords}
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
        {!running && state.delivery && state.delivery.completed > 0 && state.delivery.completed < state.delivery.milestones.length && (
          <p className="px-4 text-xs text-grey-600">Next: {milestoneName(state.delivery.milestones[state.delivery.completed].id, state.delivery.milestones[state.delivery.completed].title)}. It&apos;s a separate build, about {formatCredits(state.estimate.buildMicro)}.</p>
        )}
        <OutOfCredits open={ws.needsCredits} freeCredits={state.freePolicy === "verified"} onContinue={continueAfterCredits} onRefresh={ws.refresh} />
        {state.outdatedContracts.length > 0 && !running && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-block bg-warning/10 p-4 text-sm" role="status">
            <p className="min-w-0 flex-1">
              <span className="font-semibold">{state.outdatedContracts.join(", ")} {state.outdatedContracts.length > 1 ? "don't" : "doesn't"} have your latest contract changes yet.</span>{" "}
              <span className="text-grey-600">{sameAddress ? "Update it from your wallet to apply them. The address, funds and data stay the same." : "Your app keeps using the live version until you deploy again."}</span>
            </p>
            <DeployButton label={sameAddress ? "Update your live contract" : "Deploy again"} size="sm" />
          </div>
        )}
        {!running && state.remembered && state.remembered.length > 0 && <Remembered items={state.remembered} projectId={state.project.id} onChange={ws.refresh} />}
        <OldFundsCard projectId={state.project.id} chainId={state.project.chainId} refreshKey={state.project.currentVersion} busy={running} onAsk={suggest} />
        {state.freePolicy === "verified" ? !running && <FreeCreditsCard compact onChange={ws.refresh} /> : state.offerVerification && !running && <VerifyCard onVerified={ws.refresh} />}
        {/* A MiniPay app (D88): deploy, publish, then the steps to open it in MiniPay. */}
        {hasMiniPayKit(state.files) && state.project.currentVersion > 0 && !running && onPublish && (
          <MiniPayGuide
            projectId={state.project.id}
            chainId={state.project.chainId}
            files={state.files}
            hasContracts={Object.keys(state.files).some(isDeployableSource)}
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
        availableMicro={state.availableMicro}
        onSend={onComposerSend}
        onStop={ws.stop}
        focusCue={composerCue}
        placeholder={
          openQuestion
            ? "Or type your own answer here."
            : lastRecord?.intake && lastRecord.intake.for !== "plan" && !state.project.currentVersion
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
  availableMicro = null,
  onSend,
  onStop,
  placeholder,
  focusCue = 0,
}: {
  /** `pending`: uploaded since the last message; shown as chips and sent with the next one. */
  assets: Array<AssetInfo & { pending?: boolean }>;
  assetUrls: Record<string, string>;
  onUpload: (file: File, kind: AssetKind) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
  onChangeKind: (id: string, kind: AssetKind) => Promise<void>;
  uploading: boolean;
  running: boolean;
  estimate: { buildMicro: number; planMicro: number };
  /** What the person can spend now (paid plus free); null when unknown. Below a build's estimate, the composer says so (D138). */
  availableMicro?: number | null;
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
  // D138: a build bigger than the balance still starts (it pauses and saves if it runs low), but the person knows first.
  const short = mode === "build" && availableMicro !== null && est > 0 && availableMicro < est;
  const [dragging, setDragging] = React.useState(false);
  // Chips are the files going with the next message. Files already sent live in their messages,
  // and stay reachable under "Project files" to remove or re-classify.
  const pending = assets.filter((a) => a.pending);
  const earlier = assets.filter((a) => !a.pending);
  const [showEarlier, setShowEarlier] = React.useState(false);
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
      {showEarlier && earlier.length > 0 && (
        <div className="mb-3 border-b border-hairline pb-1">
          <p className="mb-2 px-1 text-[11px] text-grey-600">Already sent. The builder can use these in any change.</p>
          <AssetBar assets={earlier} assetUrls={assetUrls} onRemove={(id) => void onRemove(id)} onChangeKind={(id, k) => void onChangeKind(id, k)} />
        </div>
      )}
      <AssetBar assets={pending} assetUrls={assetUrls} onRemove={(id) => void onRemove(id)} onChangeKind={(id, k) => void onChangeKind(id, k)} />
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
        {earlier.length > 0 && (
          <button
            type="button"
            onClick={() => setShowEarlier((v) => !v)}
            aria-expanded={showEarlier}
            title="Files you sent earlier in this project"
            className="inline-flex h-8 items-center gap-1 rounded-full bg-surface px-3 text-xs font-medium text-grey-600 outline-none hover:text-violet focus-visible:shadow-focus"
          >
            Files {earlier.length}
            <ChevronDown className={cn("size-3 transition-transform", showEarlier && "rotate-180")} aria-hidden />
          </button>
        )}
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
        {/* D164: what the toggle means, in words a phone shows too (hover titles don't show on phones). */}
        <span className="text-[11px] text-grey-600" aria-live="polite">{mode === "plan" ? "Talk it through. Nothing changes." : "Changes your app."}</span>
        </div>
        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {short ? (
            <span className="text-xs text-warning" role="status" title="This build may cost more than you have. If your credits run low it pauses, saves what it made, and Continue picks up from there after a top-up.">
              ≈ {formatCredits(est)} · you have {formatCreditsShort(availableMicro ?? 0)}, it may pause {running ? "· runs after this build" : ""}
            </span>
          ) : (
            <span className="text-xs text-grey-400" title="Estimated charge for this request: AI cost + 25%. Planning is free. Verify with GoodDollar for 40 free credits.">
              ≈ {formatCredits(est)} {running ? "· runs after this build" : ""}
            </span>
          )}
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

/**
 * What GoodBuild remembers about this app (D164, like Codex's AGENTS.md): the decisions it keeps from earlier
 * messages ("Brand colour #0f766e"). Folded; each can be removed.
 */
export function Remembered({ items, projectId, onChange }: { items: string[]; projectId: string; onChange: () => Promise<unknown> }) {
  const [busy, setBusy] = React.useState<string | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  // Forgotten on the server: hidden here even if the refresh after it fails.
  const [gone, setGone] = React.useState<string[]>([]);
  const shown = items.filter((i) => !gone.includes(i));
  const forget = async (item: string) => {
    setBusy(item);
    setFailed(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/memory`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ remove: item }) });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { message?: string };
        setFailed(body.message ?? "That wasn't forgotten. Try again.");
        return;
      }
      setGone((g) => [...g, item]);
      const fresh = await onChange().catch(() => null);
      if (fresh === null) setFailed("Forgotten. The list couldn't refresh, so reload the page to see it up to date.");
    } catch {
      setFailed("Couldn't reach GoodBuild, so that wasn't forgotten. Try again.");
    } finally {
      setBusy(null);
    }
  };
  return (
    <details className="px-1 text-xs text-grey-600">
      <summary className="w-fit cursor-pointer rounded-full outline-none select-none focus-visible:shadow-focus">
        What GoodBuild remembers about this app ({shown.length})
      </summary>
      {failed && (
        <p className="mt-2 text-warning" role="status">
          {failed}
        </p>
      )}
      <ul className="mt-2 grid gap-1.5" aria-label="What GoodBuild remembers">
        {shown.map((item) => (
          <li key={item} className="flex items-start justify-between gap-3 rounded-block bg-canvas px-3 py-2">
            <span className="min-w-0 text-ink">{item}</span>
            <button type="button" className="shrink-0 font-medium text-violet hover:underline disabled:opacity-55" disabled={busy !== null} onClick={() => void forget(item)}>
              {busy === item ? "Forgetting…" : "Forget"}
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The files a message was sent with, above its bubble: image thumbnails, other files by name. */
function SentFiles({ ids, assets, assetUrls }: { ids: string[]; assets: AssetInfo[]; assetUrls: Record<string, string> }) {
  const sent = ids.map((id) => assets.find((a) => a.id === id)).filter((a): a is AssetInfo => Boolean(a));
  if (!sent.length) return null;
  return (
    <ul className="flex max-w-[90%] flex-wrap justify-end gap-2" aria-label="Files sent with this message">
      {sent.map((a) =>
        a.mime.startsWith("image/") && assetUrls[a.name] ? (
          <li key={a.id} title={`${a.name} · ${KIND_LABEL[a.kind]}`}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data URL thumbnail */}
            <img src={assetUrls[a.name]} alt={`${KIND_LABEL[a.kind]}: ${a.name}`} className="size-24 rounded-block bg-tint object-cover sm:size-28" />
          </li>
        ) : (
          <li key={a.id} className="flex items-center gap-1.5 rounded-full bg-tint px-3 py-1.5 text-[13px] font-medium text-violet" title={a.description || a.name}>
            <FileIcon className="size-4" aria-hidden />
            <span className="max-w-[10rem] truncate">{a.name}</span>
            <span className="text-[11px] font-normal text-grey-600">{KIND_LABEL[a.kind]}</span>
          </li>
        ),
      )}
    </ul>
  );
}
