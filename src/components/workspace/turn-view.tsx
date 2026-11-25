"use client";

import * as React from "react";
import { ArrowRight, ArrowUpRight, Check, Eye, Hexagon, RotateCw, Undo2, Wrench } from "lucide-react";

import { DeployButton, useDeployAction } from "@/components/deploy/deploy-trigger";
import { Button } from "@/components/ui/button";
import { chainLabel } from "@/lib/deploy/explorer";
import { formatCredits, formatCreditsShort } from "@/lib/credits-math";
import type { Step, TurnRecord } from "@/lib/turn-types";
import { formatClock, useElapsed, WaitNote, WaveDots } from "@/components/ui/wait";
import { cn } from "@/lib/utils";
import { CHECKING_STEP, plainStep, planStepText } from "@/lib/plain-steps";
import { AI_PAUSED_HELD, isAiAccountEmpty, plainError, plainMilestoneTitle } from "@/lib/plain-words";
import { PlanCard, PlanDraftCard, type PlanActions, type PlanDraftActions } from "./plan-card";
import { REVIEW_FIX_LEAD, VISUAL_FIX_LEAD, type TurnAction } from "@/lib/turn-actions";

/** A step running this long gets a calm explanation (A2). */
const SLOW_STEP_SECONDS = 20;

/** Plain words for the steps a non-technical person sees (D164: from lib/plain-steps, file names kept apart). */
export function plainStepLabel(label: string): string {
  return plainStep({ id: "", label })?.text ?? label;
}

/** Status dot for a step row: violet check, pink spinner, or danger dot. */
function StepDot({ status }: { status: Step["status"] }) {
  if (status === "done") {
    return (
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-violet text-white" aria-label="Done">
        <Check className="size-2.5" strokeWidth={3.5} />
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center" aria-label="Failed">
        <span className="size-2 rounded-full bg-danger" />
      </span>
    );
  }
  return (
    <span
      className="mt-0.5 size-4 shrink-0 rounded-full border-2 border-pink border-t-transparent animate-spin motion-reduce:animate-none"
      aria-label="Running"
    />
  );
}

/**
 * One step row. A running step shows its own seconds, its title breathes, and past 20s it explains. A step
 * with steps of its own (a fix attempt) lists them indented under it, and while it runs it says which one it
 * is on, so its work is visibly part of it.
 */
function StepRow({ step, live, substeps = [] }: { step: Step; live: boolean; substeps?: Step[] }) {
  const running = live && step.status === "running";
  const seconds = useElapsed(running);
  const current = running ? substeps.at(-1) : undefined;
  const plain = plainStep(step);
  // D164: a file step shows its words and the file name faintly; its line counts aren't for people.
  const detail = current ? `Working on it: ${plainStepLabel(current.label)}` : plain?.file ? undefined : step.detail && !/error|\.tsx?|\.sol|:\d/i.test(step.detail) ? step.detail : undefined;
  return (
    <li className={cn("py-2", live && "animate-lift motion-reduce:animate-none")}>
      <div className="flex items-start gap-3">
        <StepDot status={step.status} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", running && "animate-pulse-dot motion-reduce:animate-none")}>
            <span>{plain?.text ?? step.label}</span>
            {plain?.file && <span className="ml-1.5 font-mono text-[11px] font-normal text-grey-400">{plain.file.split("/").pop()}</span>}
          </p>
          {detail && <p className="truncate text-xs text-grey-600">{detail}</p>}
        </div>
        {running && seconds > 0 && <span className="mt-0.5 font-mono text-[11px] text-grey-600">{seconds}s</span>}
      </div>
      {substeps.length > 0 && (
        <ol className="mt-1 ml-7 border-l border-grey-200 pl-3" aria-label={`${plainStepLabel(step.label)}: steps`}>
          {substeps.map((c) => (
            <StepRow key={c.id} step={c} live={live} />
          ))}
        </ol>
      )}
      {running && !current && seconds >= SLOW_STEP_SECONDS && (
        <WaitNote tone="calm" className="mt-2 ml-7">
          This part is taking longer than usual. Nothing is lost, and you can leave this tab open.
        </WaitNote>
      )}
    </li>
  );
}

/** Step rows (DESIGN_SYSTEM §4, wait-state pick A2). They fold away once a turn has ended well. */
export function StepRows({ steps, open = true, live = false }: { steps: Step[]; open?: boolean; live?: boolean }) {
  if (!steps.length) return null;
  const rows = (
    <ol className="mt-3 rounded-block bg-[#FAFAFA] px-4 py-1" aria-label="Build steps">
      {steps
        .filter((s) => plainStep(s) !== null)
        .filter((s) => !s.parent || !steps.some((p) => p.id === s.parent))
        .map((s) => (
          <StepRow key={s.id} step={s} live={live} substeps={steps.filter((c) => c.parent === s.id)} />
        ))}
    </ol>
  );
  if (open) return rows;
  return (
    <details className="mt-3 text-xs text-grey-600">
      <summary className="w-fit cursor-pointer rounded-full outline-none select-none focus-visible:shadow-focus">
        {steps.length} {steps.length === 1 ? "step" : "steps"} done
      </summary>
      {rows}
    </details>
  );
}

/**
 * One line that says what the builder is doing right now (D164). It slides in when a step starts and fades out
 * when that step is done, so something visibly moves without a growing list. The file name sits faintly at the end.
 */
export function TrailLine({ step, className }: { step?: Step; className?: string }) {
  const plain = step ? plainStep(step) : null;
  if (!step || !plain) return null;
  const done = step.status !== "running";
  return (
    <p className={cn("flex h-5 min-w-0 items-center gap-1.5 overflow-hidden text-xs text-grey-600", done ? "gb-trail-out" : "gb-trail-in", className)} aria-live="polite">
      <span className="size-1.5 shrink-0 rounded-full bg-pink animate-pulse motion-reduce:animate-none" aria-hidden />
      <span className="truncate">{plain.text}</span>
      {plain.file && <span className="shrink-0 font-mono text-[11px] text-grey-400">{plain.file.split("/").pop()}</span>}
    </p>
  );
}

/** Steps that tell the plan-step checklist where the build is (D164). Older turns have none. */
export function tracksPlan(record: Pick<TurnRecord, "mode" | "plan" | "steps">): boolean {
  return record.mode === "build" && Boolean(record.plan?.steps.length) && record.steps.some((s) => s.plan !== undefined);
}

/**
 * The builder's plan as a checklist (D164, after Codex's update_plan): its steps, then GoodBuild's own
 * "checking it works". One step works at a time, with the trail line under it. Once the turn ends it folds away.
 */
export function PlanProgress({ record, live, open = false }: { record: TurnRecord; live: boolean; open?: boolean }) {
  const items = [...(record.plan?.steps ?? []).map(planStepText), CHECKING_STEP];
  const tracked = record.steps.filter((s) => s.plan !== undefined);
  const active = Math.min(items.length - 1, Math.max(0, ...tracked.map((s) => s.plan!)));
  const ended = !live;
  const ok = ended && (record.status === "ready" || record.status === "answered");
  const trail = live ? [...tracked].reverse().find((s) => s.plan === active && plainStep(s)) : undefined;
  const list = (
    <ol className="mt-3 rounded-block bg-[#FAFAFA] px-4 py-3" aria-label="Build plan">
      <li className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-semibold">{ok ? "Done" : ended ? "Where it got to" : "Building your app"}</span>
        <span className="font-mono text-[11px] text-grey-600 tabular-nums">{ok ? `${items.length} of ${items.length}` : `Step ${active + 1} of ${items.length}`}</span>
      </li>
      {items.map((text, i) => {
        const status: Step["status"] | "waiting" | "stuck" = ok || i < active ? "done" : i > active ? "waiting" : live ? "running" : "stuck";
        return (
          <li key={i} className="grid grid-cols-[16px_minmax(0,1fr)] gap-x-3 py-1.5">
            {status === "waiting" ? (
              <span className="mt-0.5 size-4 rounded-full border-2 border-grey-200" aria-label="Not started" />
            ) : status === "stuck" ? (
              <span className="mt-0.5 grid size-4 place-items-center" aria-label="Needs a fix"><span className="size-2 rounded-full bg-warning" /></span>
            ) : (
              <StepDot status={status} />
            )}
            <span className={cn("text-sm", status === "running" ? "font-medium text-ink" : status === "waiting" ? "text-grey-600" : "text-ink")}>{text}</span>
            {status === "running" && <TrailLine key={trail?.id} step={trail} className="col-start-2 mt-0.5" />}
          </li>
        );
      })}
    </ol>
  );
  if (live || !ok || open) return list;
  return (
    <details className="mt-3 text-xs text-grey-600">
      <summary className="w-fit cursor-pointer rounded-full outline-none select-none focus-visible:shadow-focus">All {items.length} steps done</summary>
      {list}
      <StepRows steps={record.steps} />
    </details>
  );
}

/** "Ready to deploy contract" card; the button opens the deploy modal (M5). */
export function DeployCard({ record, chainId }: { record: TurnRecord; chainId: number }) {
  const { deployed } = useDeployAction();
  const contracts = record.contracts ?? [];
  const main = contracts[0];
  if (!main) return null;
  if (contracts.every((c) => deployed.includes(c.name))) {
    return (
      <p className="mt-4 flex items-center gap-2 rounded-[20px] bg-tint p-4 text-sm font-semibold">
        <Check className="size-4 text-success" aria-hidden /> {contracts.map((c) => c.name).join(", ")} {contracts.length > 1 ? "are" : "is"} live on {chainLabel(chainId)}
      </p>
    );
  }
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[20px] bg-tint p-4">
      <span className="grid size-11 place-items-center rounded-block bg-violet text-white" aria-hidden>
        <Hexagon className="size-5" />
      </span>
      <div className="min-w-[60%] flex-1">
        <p className="text-sm font-semibold">Ready to deploy {contracts.map((c) => c.name).join(", ")}</p>
        <p className="text-xs text-grey-600">
          {chainLabel(chainId)} · {contracts.length > 1 ? `${contracts.length} contracts, one signature each` : "one signature"} · you sign from your own wallet
        </p>
      </div>
      <DeployButton label="Deploy contract" size="sm" className="w-full px-4 py-2.5 text-sm sm:w-auto" />
    </div>
  );
}

/** Seconds of quiet (no reply, step or log line) before the chat says the build is still working (D138). */
const QUIET_NOTE_AFTER_S = 90;

/** A build's estimate against what the person can spend; haveMicro null when unknown (D138). */
export interface ContinueCost {
  needMicro: number;
  haveMicro: number | null;
}

/**
 * The one problem card (D164; DESIGN_SYSTEM §4 error card). Whatever went wrong (the build stopped, it still
 * needs a fix, the preview crashed), there is one card and one button, "Fix it for me", which continues from the
 * saved files and fixes all of it. The technical text is behind one fold, for support.
 */
export function TurnError({
  record,
  onFix,
  disabled,
  continueCost,
  previewError,
  held,
}: {
  record: TurnRecord;
  onFix: () => void;
  disabled: boolean;
  continueCost?: ContinueCost;
  /** The preview's crash, when there is one: the button fixes it too (D164). */
  previewError?: string | null;
  /** D177: this build failed on GoodBuild's empty AI account and is saved to start again on its own: no button. */
  held?: boolean;
}) {
  if (held && isAiAccountEmpty(record.error)) return <HeldNotice />;
  // Paused for credits (D138): its files are a saved draft, and Continue picks up from them.
  const paused = record.paused === "credits";
  const needsFix = record.status === "needs_fix" && !paused;
  const left = record.steps.find((s) => s.id === "autofix" && s.status === "error");
  const leftWords = left ? plainStep(left)?.text : undefined;
  const crash = previewError ? " The preview crashed too, and this fixes that as well." : "";
  const technical = [record.status === "error" ? record.error : "", previewError ?? "", record.log.join("\n")].filter(Boolean).join("\n\n");
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", paused || needsFix ? "bg-warning" : "bg-danger")} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium">{paused ? "Paused: your credits ran low" : "Your app isn't finished yet"}</p>
            <p className="text-sm text-grey-600">
              {paused
                ? record.error ?? "What it made so far is saved."
                : needsFix
                  ? `${leftWords ? `${leftWords}. ` : ""}Your files are saved. Tap the button and GoodBuild picks up from here and fixes what's left.${crash}`
                  : isAiAccountEmpty(record.error)
                    ? plainError(record.error)
                    : `${plainError(record.error)} Tap the button and GoodBuild picks up from your saved files.${crash}`}
            </p>
            {paused && continueCost && continueCost.needMicro > 0 && (
              <p className={cn("mt-1 text-xs", continueCost.haveMicro !== null && continueCost.haveMicro < continueCost.needMicro ? "text-warning" : "text-grey-600")}>
                Continuing costs about {formatCredits(continueCost.needMicro)}
                {continueCost.haveMicro !== null ? `; you have ${formatCredits(continueCost.haveMicro)}` : ""}. If it runs low again, it pauses and saves again.
              </p>
            )}
          </div>
        </div>
        <Button variant="chipSelected" size="sm" onClick={onFix} disabled={disabled}>
          {paused ? <RotateCw /> : <Wrench />}
          {paused ? (continueCost && continueCost.needMicro > 0 ? `Continue · ≈ ${formatCreditsShort(continueCost.needMicro)}` : "Continue") : "Fix it for me"}
        </Button>
      </div>
      {technical && (
        <details className="mt-3 pl-5 text-xs text-grey-600">
          <summary className="w-fit cursor-pointer rounded-full outline-none select-none focus-visible:shadow-focus">Technical details (for support)</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-block bg-surface p-3 font-mono text-[12px] whitespace-pre-wrap">{technical}</pre>
        </details>
      )}
    </div>
  );
}

/** "Undo this change" with its confirm in the page (D164): the app goes back to the version before this message. */
export function UndoButton({ onUndo, disabled }: { onUndo: () => void; disabled: boolean }) {
  const [asking, setAsking] = React.useState(false);
  if (!asking) {
    return (
      <Button variant="secondary" size="sm" className="h-8 px-3 text-xs" disabled={disabled} onClick={() => setAsking(true)}>
        <Undo2 />
        Undo this change
      </Button>
    );
  }
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2 rounded-block bg-canvas px-3 py-2 text-xs" role="group" aria-label="Undo this change">
      <span className="mr-auto text-grey-600">Your app goes back to how it was before this message. The chat stays.</span>
      <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setAsking(false)}>
        Keep it
      </Button>
      <Button
        variant="chipSelected"
        size="sm"
        className="h-8 px-3 text-xs"
        disabled={disabled}
        onClick={() => {
          setAsking(false);
          onUndo();
        }}
      >
        Go back
      </Button>
    </div>
  );
}

/** Next steps as chips (DESIGN_SYSTEM: tint pills); a click sends the suggestion as the next prompt. */
export function SuggestionChips({ items, onPick, disabled }: { items: string[]; onPick: (s: string) => void; disabled: boolean }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Suggested next steps">
      {items.map((s) => (
        <Button key={s} type="button" variant="chip" size="chip" disabled={disabled} onClick={() => onPick(s)} className="h-auto max-w-full text-left whitespace-normal">
          <span>{s}</span>
          <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
        </Button>
      ))}
    </div>
  );
}

/** Visual check result (P17): a quiet line when it looks right, a card with "Fix these" when not. */
export function VisualCheckNote({ record, checking, failed, onFix, disabled }: { record: TurnRecord; checking?: boolean; failed?: string | null; onFix?: (prompt: string, action?: TurnAction) => void; disabled: boolean }) {
  const check = record.visualCheck;
  if (!check && checking) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5 animate-pulse motion-reduce:animate-none" aria-hidden /> Checking the preview…
      </p>
    );
  }
  if (!check && failed) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5" aria-hidden /> {failed}
      </p>
    );
  }
  if (!check) return null;
  if (check.ok) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5 text-success" aria-hidden /> Checked on {check.width <= 600 ? "a phone" : "a computer"}: looks right.
      </p>
    );
  }
  const prompt = `${VISUAL_FIX_LEAD} on ${check.width <= 600 ? "a phone" : "a computer"} (${check.width}px wide):\n${check.issues.map((i) => `- ${i}`).join("\n")}`;
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Checked on {check.width <= 600 ? "a phone" : "a computer"}: {check.issues.length === 1 ? "one thing looks off" : `${check.issues.length} things look off`}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-grey-600">
            {check.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
      {onFix && (
        <div className="mt-3 flex justify-end">
          <Button variant="chipSelected" size="sm" disabled={disabled} onClick={() => onFix(prompt, "repair")}>
            <Wrench />
            Fix it for me
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The builder's own look at the page (D87). A quiet line when it looked right or when it fixed what
 * it saw; a card with "Fix these" only when it saw something and left the page as it was.
 */
export function ReviewNote({ record, onFix, disabled }: { record: TurnRecord; onFix?: (prompt: string, action?: TurnAction) => void; disabled: boolean }) {
  const review = record.review;
  if (!review) return null;
  if (review.ok) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5 text-success" aria-hidden /> Checked on a phone and a computer: looks right.
      </p>
    );
  }
  const count = review.issues.length === 1 ? "one thing" : `${review.issues.length} things`;
  if (review.fixed) {
    return (
      <details className="mt-3 text-xs text-grey-600">
        <summary className="flex cursor-pointer list-none items-center gap-2 outline-none focus-visible:shadow-focus">
          <Eye className="size-3.5 text-success" aria-hidden /> Checked on a phone and a computer, and fixed {count}.
        </summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-9">
          {review.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </details>
    );
  }
  const prompt = `${REVIEW_FIX_LEAD}:\n${review.issues.map((i) => `- ${i}`).join("\n")}`;
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Checked on a phone and a computer: {count} still {review.issues.length === 1 ? "looks" : "look"} off</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-grey-600">
            {review.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
      {onFix && (
        <div className="mt-3 flex justify-end">
          <Button variant="chipSelected" size="sm" disabled={disabled} onClick={() => onFix(prompt, "repair")}>
            <Wrench />
            Fix it for me
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A finished build, as in the owner's mock (D164): "Ready to try", one headline, a short list of what works
 * (ticks) and what comes later (an empty circle), one "Next" button, and one quiet footer line with the check,
 * the steps (folded), the cost and Undo.
 */
export function FinishedBuild({
  record,
  headline,
  detail,
  works,
  later,
  chainId,
  onSuggest,
  disabled,
  onUndo,
  checking,
  checkFailed,
}: {
  record: TurnRecord;
  headline: string;
  /** The rest of the reply, such as what deploying will ask for. */
  detail?: string;
  /** Why the preview check has no result, when it has none. */
  checkFailed?: string | null;
  works: string[];
  later?: string;
  chainId: number;
  onSuggest?: (prompt: string, action?: TurnAction) => void;
  disabled: boolean;
  onUndo?: () => void;
  checking?: boolean;
}) {
  const [showSteps, setShowSteps] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const review = record.review;
  const visual = record.visualCheck;
  const looked = review ? review.ok || review.fixed : visual?.ok;
  const lookedNote = review && !review.ok && !review.fixed ? <ReviewNote record={record} onFix={onSuggest} disabled={disabled} /> : !review && visual && !visual.ok ? <VisualCheckNote record={record} onFix={onSuggest} disabled={disabled} /> : null;
  const stepCount = tracksPlan(record) ? (record.plan?.steps.length ?? 0) + 1 : record.steps.filter((s) => plainStep(s) && !s.parent).length;
  const [next, ...more] = onSuggest ? record.suggestions ?? [] : [];
  return (
    <div className="grid gap-3">
      <div className="grid gap-1.5">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-success/10 px-2.5 py-1 text-[11px] font-semibold tracking-[.06em] text-success uppercase">
          <span className="size-1.5 rounded-full bg-success" aria-hidden />
          Ready to try
        </span>
        <p className="text-[17px] leading-snug font-semibold text-balance">{headline}</p>
        {detail && <p className="text-sm leading-relaxed text-grey-600">{detail}</p>}
      </div>
      <ul className="rounded-block bg-[#FAFAFA] px-4 py-1.5" aria-label="What works">
        {works.map((w) => (
          <li key={w} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 border-hairline py-2.5 text-sm leading-normal [&+li]:border-t">
            <span className="mt-px grid size-[18px] place-items-center rounded-full bg-success text-white" aria-label="Works">
              <Check className="size-3" strokeWidth={3.5} />
            </span>
            <span>{w}</span>
          </li>
        ))}
        {later && (
          <li className="grid grid-cols-[18px_minmax(0,1fr)] gap-2.5 border-t border-hairline py-2.5 text-sm leading-normal">
            <span className="mt-px size-[18px] rounded-full border-2 border-grey-200" aria-label="Comes later" />
            <span className="text-grey-600">{later}</span>
          </li>
        )}
      </ul>
      <DeployCard record={record} chainId={chainId} />
      {lookedNote}
      {next && onSuggest && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Next steps">
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSuggest(next)}
            className="inline-flex max-w-full items-center gap-2 rounded-full bg-violet py-2 pr-2 pl-4 text-left text-sm font-medium text-white outline-none hover:bg-violet/92 focus-visible:shadow-focus disabled:opacity-55"
          >
            <span className="min-w-0">Next: {next.charAt(0).toLowerCase() + next.slice(1)}</span>
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-pink text-violet-ink" aria-hidden>
              <ArrowRight className="size-3.5" strokeWidth={2.5} />
            </span>
          </button>
          {more.map((m) => (
            <Button key={m} type="button" variant="chip" size="chip" disabled={disabled} onClick={() => onSuggest(m)} className="h-auto max-w-full text-left whitespace-normal">
              <span>{m}</span>
              <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            </Button>
          ))}
        </div>
      )}
      {asking && onUndo ? (
        <div className="flex flex-wrap items-center justify-end gap-2 rounded-block bg-canvas px-3 py-2 text-xs" role="group" aria-label="Undo this change">
          <span className="mr-auto text-grey-600">Your app goes back to how it was before this message. The chat stays.</span>
          <Button variant="ghost" size="sm" className="h-8 px-3 text-xs" onClick={() => setAsking(false)}>
            Keep it
          </Button>
          <Button variant="chipSelected" size="sm" className="h-8 px-3 text-xs" disabled={disabled} onClick={() => { setAsking(false); onUndo(); }}>
            Go back
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-hairline pt-3 text-xs text-grey-600">
          {looked ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success">
              <Check className="size-3.5" strokeWidth={3} aria-hidden /> Checked on {review ? "a phone and a computer" : visual && visual.width <= 600 ? "a phone" : "a computer"}
            </span>
          ) : checking ? (
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5 animate-pulse motion-reduce:animate-none" aria-hidden /> Checking the preview…
            </span>
          ) : checkFailed ? (
            <span className="inline-flex items-center gap-1">
              <Eye className="size-3.5" aria-hidden /> {checkFailed}
            </span>
          ) : null}
          {looked || checking || checkFailed ? <span className="text-grey-400" aria-hidden>·</span> : null}
          {stepCount > 0 && (
            <button type="button" aria-expanded={showSteps} onClick={() => setShowSteps((v) => !v)} className="rounded-full underline decoration-grey-200 underline-offset-[3px] outline-none hover:text-violet focus-visible:shadow-focus">
              {stepCount} {stepCount === 1 ? "step" : "steps"}
            </button>
          )}
          {record.chargedMicro > 0 && (
            <>
              <span className="text-grey-400" aria-hidden>·</span>
              <span>{formatCredits(record.chargedMicro)}</span>
            </>
          )}
          {onUndo && (
            <button type="button" disabled={disabled} onClick={() => setAsking(true)} className="ml-auto inline-flex items-center gap-1 rounded-full font-medium text-violet outline-none hover:underline focus-visible:shadow-focus disabled:opacity-55">
              <Undo2 className="size-3.5" aria-hidden /> Undo
            </button>
          )}
        </div>
      )}
      {showSteps && (tracksPlan(record) ? <PlanProgress record={record} live={false} open /> : <StepRows steps={record.steps} />)}
    </div>
  );
}

/**
 * An assistant turn: text, steps, then the plan's questions, the deploy card or an error card. The
 * build log and file changes stay on the record (the error card's Logs, the Code tab) but aren't
 * shown here: people found them confusing, and they say nothing someone building an app needs.
 */
/** D177: a request waiting while GoodBuild's AI account is empty (DESIGN_SYSTEM §4 card, warning dot, no button). */
export function HeldNotice() {
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">Waiting to start</p>
          <p className="text-sm text-grey-600">{AI_PAUSED_HELD}</p>
        </div>
      </div>
    </div>
  );
}

export function TurnView({
  text,
  record,
  chainId,
  live,
  onFix,
  fixDisabled,
  onSuggest,
  checking,
  checkFailed,
  plan,
  draft,
  onSkipPlan,
  continueCost,
  onUndo,
  previewError,
  held,
}: {
  text: string;
  record: TurnRecord;
  chainId: number;
  live: boolean;
  onFix: () => void;
  /** Latest finished build only: put the app back to how it was before this message (D164). */
  onUndo?: () => void;
  /** The preview's crash, shown and fixed through this turn's problem card (D164). Latest turn only. */
  previewError?: string | null;
  fixDisabled: boolean;
  /** What Continue on a build paused for credits would cost, and what the person has (D138). Latest turn only. */
  continueCost?: ContinueCost;
  /** Set on the latest turn only: shows its suggestion chips. */
  onSuggest?: (prompt: string, action?: TurnAction) => void;
  /** The visual check of this turn's preview is running. */
  checking?: boolean;
  /** Why the visual check of this turn's preview has no result, when it has none. */
  checkFailed?: string | null;
  /** Set while this turn's questions can still be answered. Without it they show read-only. */
  plan?: PlanActions;
  /** Set while this turn's drafted plan (Plan mode) can still be built or changed. Without it the plan shows read-only. */
  draft?: PlanDraftActions;
  /** Set while the questions are still being written. */
  onSkipPlan?: () => void;
  /** D177: an empty-AI-account failure whose request is saved to start on its own. */
  held?: boolean;
}) {
  const showError = !live && (record.status === "needs_fix" || record.status === "error");
  // The clock runs whenever nothing has been said yet, and starts again at each new step or log line, so a
  // long quiet step (a big file being written) shows how long it has been quiet instead of a bare "Thinking" (D138).
  const thinking = live && !text;
  const activity = `${record.steps.length}:${record.steps.at(-1)?.status ?? ""}:${record.log.length}`;
  const thinkingFor = useElapsed(thinking, activity);
  // D164: the plan as a checklist once the builder has one; before that, one trail line under "Thinking".
  const checklist = tracksPlan(record);
  const latest = [...record.steps].reverse().find((s) => plainStep(s));
  const outcome = !live && record.status === "ready" && (record.outcome?.works.length || record.outcome?.later) ? record.outcome : undefined;
  if (outcome) {
    return (
      <FinishedBuild
        record={record}
        headline={outcome.headline || text.split(/(?<=[.!?])\s/)[0]}
        detail={outcome.detail}
        works={outcome.works}
        later={outcome.later}
        chainId={chainId}
        onSuggest={onSuggest}
        disabled={fixDisabled}
        onUndo={onUndo}
        checking={checking}
        checkFailed={checkFailed}
      />
    );
  }
  return (
    <div>
      {text ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      ) : live ? (
        <>
          <p className="flex items-center gap-2 text-sm text-grey-600" role="status">
            <WaveDots /> {record.plan ? "Working on it" : "Thinking"}
            {thinkingFor > 0 && <span className="font-mono text-[11px]">{formatClock(thinkingFor)}</span>}
          </p>
        </>
      ) : null}
      {live && !checklist && <TrailLine key={latest?.id} step={latest} className="mt-1 ml-0.5" />}
      {live && !text && thinkingFor >= QUIET_NOTE_AFTER_S && (
        <WaitNote tone="calm" className="mt-2">
          Still working. A big step, like writing a large file, can take a few minutes. If it goes quiet for too long, GoodBuild retries it.
        </WaitNote>
      )}
      {onSkipPlan && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3.5" onClick={onSkipPlan}>
          Skip, just build it
        </Button>
      )}
      {checklist ? (
        <PlanProgress record={record} live={live} />
      ) : (
        // Turns saved before D164, and small changes without a plan: plain step rows, folded while it runs.
        !live && <StepRows steps={record.steps} open={record.status === "needs_fix" || record.status === "error" || record.status === "stopped"} />
      )}
      {record.intake && <PlanCard intake={record.intake} actions={plan} />}
      {record.mode === "plan" && record.plan && !record.intake && <PlanDraftCard plan={record.plan} actions={!live ? draft : undefined} />}
      {!live && record.status === "ready" && <DeployCard record={record} chainId={chainId} />}
      {showError && <TurnError record={record} onFix={onFix} disabled={fixDisabled} continueCost={continueCost} previewError={previewError} held={held} />}
      {!live && record.status === "stopped" && record.mode === "build" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-grey-600" role="status">
          <span className="size-2 shrink-0 rounded-full bg-grey-400" aria-hidden />
          Stopped. This build&apos;s edits were discarded; your files are as they were.
        </p>
      )}
      {/* One button per turn (D164): with a problem card showing, the check notes have no button of their own. */}
      {!live && record.review && <ReviewNote record={record} onFix={showError ? undefined : onSuggest} disabled={fixDisabled} />}
      {!live && !record.review && <VisualCheckNote record={record} checking={checking} failed={checkFailed} onFix={showError ? undefined : onSuggest} disabled={fixDisabled} />}
      {!live && onSuggest && record.status !== "error" && record.suggestions?.length ? (
        <SuggestionChips items={record.suggestions} onPick={onSuggest} disabled={fixDisabled} />
      ) : null}
      {!live && record.draftSaved && !showError && <p className="mt-3 text-xs text-grey-600">Your files are saved.</p>}
      {/* D164 (owner): no talk of free builds or fixes; the cost line below shows what was charged. */}
      {!live && (record.refundedMicro ?? 0) > 0 && <p className="mt-3 text-xs text-grey-600">Nothing was built, so the {formatCredits(record.refundedMicro!)} of AI for this reply was refunded.</p>}
      {!live && record.delivery && !record.outcome && record.delivery.remaining.length > 0 && (
        <p className="mt-3 text-xs text-grey-600">Still to come: {[...new Set(record.delivery.remaining.map(plainMilestoneTitle))].join(", ")}</p>
      )}
      {!live && (record.version || record.chargedMicro > 0 || onUndo) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-grey-400">
            {record.version ? `Saved as v${record.version}` : ""}
            {record.version && record.chargedMicro > 0 ? " · " : ""}
            {record.chargedMicro > 0 ? `${formatCredits(record.chargedMicro)} of AI` : ""}
          </p>
          {onUndo && <UndoButton onUndo={onUndo} disabled={fixDisabled} />}
        </div>
      )}
    </div>
  );
}
