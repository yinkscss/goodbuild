"use client";

import * as React from "react";
import { ArrowUpRight, Check, Eye, Hexagon, RotateCw, Wrench } from "lucide-react";

import { DeployButton, useDeployAction } from "@/components/deploy/deploy-trigger";
import { Button } from "@/components/ui/button";
import { chainLabel } from "@/lib/deploy/explorer";
import { formatCredits } from "@/lib/credits-math";
import type { Step, TurnRecord } from "@/lib/turn-types";
import { formatClock, useElapsed, WaitNote, WaveDots } from "@/components/ui/wait";
import { cn } from "@/lib/utils";
import { PlanCard, PlanDraftCard, type PlanActions, type PlanDraftActions } from "./plan-card";

/** A step running this long gets a calm explanation (A2). */
const SLOW_STEP_SECONDS = 20;

/** Plain words for the steps a non-technical person sees. Unknown labels pass through unchanged. */
export function plainStepLabel(label: string): string {
  if (/^Writing .+\.sol$/.test(label)) return "Writing your contract";
  if (label === "Compiling contracts" || label.startsWith("Compiling with solc")) return "Building your contract";
  if (label === "Testing contracts") return "Trying your contract out";
  if (label === "Checking types") return "Checking the code";
  const fix = /^Fixing errors \(attempt (\d+) of (\d+)\)$/.exec(label);
  if (fix) return `Fixing a problem (try ${fix[1]} of ${fix[2]})`;
  if (label === "Fixing what it saw") return "Tidying up what it saw";
  return label;
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

/** One step row. A running step shows its own seconds, its title breathes, and past 20s it explains. */
function StepRow({ step, live }: { step: Step; live: boolean }) {
  const running = live && step.status === "running";
  const seconds = useElapsed(running);
  return (
    <li className={cn("py-2", live && "animate-lift motion-reduce:animate-none")}>
      <div className="flex items-start gap-3">
        <StepDot status={step.status} />
        <div className="min-w-0 flex-1">
          <p className={cn("text-sm font-medium", running && "animate-pulse-dot motion-reduce:animate-none")}>{plainStepLabel(step.label)}</p>
          {step.detail && <p className="truncate text-xs text-grey-600">{step.detail}</p>}
        </div>
        {running && seconds > 0 && <span className="mt-0.5 font-mono text-[11px] text-grey-600">{seconds}s</span>}
      </div>
      {running && seconds >= SLOW_STEP_SECONDS && (
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
      {steps.map((s) => (
        <StepRow key={s.id} step={s} live={live} />
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
          {chainLabel(chainId)} · {contracts.length > 1 ? `${contracts.length} contracts, one signature each` : `${(main.bytecodeBytes / 1024).toFixed(1)} kB`} · you sign from your own wallet
        </p>
      </div>
      <DeployButton label="Deploy contract" size="sm" className="w-full px-4 py-2.5 text-sm sm:w-auto" />
    </div>
  );
}

/** Inline error card (DESIGN_SYSTEM §4): danger dot, plain cause, Try fix, expandable logs. */
export function TurnError({ record, onFix, disabled }: { record: TurnRecord; onFix: () => void; disabled: boolean }) {
  const needsFix = record.status === "needs_fix";
  const autofix = record.steps.find((s) => s.id === "autofix")?.detail;
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="alert">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-danger" aria-hidden />
          <div>
            <p className="text-sm font-medium">
              {needsFix ? `Auto-fix ${autofix ? autofix.charAt(0).toLowerCase() + autofix.slice(1) : "couldn't fix every error"}` : "This build stopped"}
            </p>
            <p className="text-sm text-grey-600">
              {needsFix ? "Your files are saved. Ask for a fix, or describe the change differently." : record.error ?? "Something went wrong."}
            </p>
          </div>
        </div>
        <Button variant="chipSelected" size="sm" onClick={onFix} disabled={disabled}>
          <RotateCw />
          {needsFix ? "Try fix" : "Try again"}
        </Button>
      </div>
      {record.log.length > 0 && (
        <details className="mt-3 pl-5 text-xs text-grey-600">
          <summary className="cursor-pointer select-none">Logs</summary>
          <pre className="mt-2 max-h-48 overflow-auto rounded-block bg-surface p-3 font-mono text-[12px] whitespace-pre-wrap">{record.log.join("\n")}</pre>
        </details>
      )}
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
export function VisualCheckNote({ record, checking, failed, onFix, disabled }: { record: TurnRecord; checking?: boolean; failed?: boolean; onFix?: (prompt: string) => void; disabled: boolean }) {
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
        <Eye className="size-3.5" aria-hidden /> The visual check couldn&apos;t run for this build. The build itself is fine.
      </p>
    );
  }
  if (!check) return null;
  if (check.ok) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5 text-success" aria-hidden /> Visual check: the preview looks right at {check.width}px.
      </p>
    );
  }
  const prompt = `Fix these visual problems the preview check found at ${check.width}px:\n${check.issues.map((i) => `- ${i}`).join("\n")}`;
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">The visual check spotted {check.issues.length === 1 ? "a problem" : `${check.issues.length} problems`}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-grey-600">
            {check.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
      {onFix && (
        <div className="mt-3 flex justify-end">
          <Button variant="chipSelected" size="sm" disabled={disabled} onClick={() => onFix(prompt)}>
            <Wrench />
            Fix these
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
export function ReviewNote({ record, onFix, disabled }: { record: TurnRecord; onFix?: (prompt: string) => void; disabled: boolean }) {
  const review = record.review;
  if (!review) return null;
  if (review.ok) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-grey-600">
        <Eye className="size-3.5 text-success" aria-hidden /> Looked at the page on a phone and a computer: it looks right.
      </p>
    );
  }
  const count = review.issues.length === 1 ? "one thing" : `${review.issues.length} things`;
  if (review.fixed) {
    return (
      <details className="mt-3 text-xs text-grey-600">
        <summary className="flex cursor-pointer list-none items-center gap-2 outline-none focus-visible:shadow-focus">
          <Eye className="size-3.5 text-success" aria-hidden /> Looked at the page on a phone and a computer, and fixed {count}.
        </summary>
        <ul className="mt-1.5 list-disc space-y-0.5 pl-9">
          {review.issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </details>
    );
  }
  const prompt = `Fix these problems you saw when you looked at the page:\n${review.issues.map((i) => `- ${i}`).join("\n")}`;
  return (
    <div className="mt-4 rounded-block bg-canvas p-4" role="status">
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2 shrink-0 rounded-full bg-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Looking at the page, the builder spotted {count} it didn&apos;t fix</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-grey-600">
            {review.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
      {onFix && (
        <div className="mt-3 flex justify-end">
          <Button variant="chipSelected" size="sm" disabled={disabled} onClick={() => onFix(prompt)}>
            <Wrench />
            Fix these
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * An assistant turn: text, steps, then the plan's questions, the deploy card or an error card. The
 * build log and file changes stay on the record (the error card's Logs, the Code tab) but aren't
 * shown here: people found them confusing, and they say nothing someone building an app needs.
 */
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
}: {
  text: string;
  record: TurnRecord;
  chainId: number;
  live: boolean;
  onFix: () => void;
  fixDisabled: boolean;
  /** Set on the latest turn only: shows its suggestion chips. */
  onSuggest?: (prompt: string) => void;
  /** The visual check of this turn's preview is running. */
  checking?: boolean;
  /** The visual check of this turn's preview couldn't produce a result. */
  checkFailed?: boolean;
  /** Set while this turn's questions can still be answered. Without it they show read-only. */
  plan?: PlanActions;
  /** Set while this turn's drafted plan (Plan mode) can still be built or changed. Without it the plan shows read-only. */
  draft?: PlanDraftActions;
  /** Set while the questions are still being written. */
  onSkipPlan?: () => void;
}) {
  const showError = !live && (record.status === "needs_fix" || record.status === "error");
  const thinking = live && !text && !record.steps.length;
  const thinkingFor = useElapsed(thinking);
  return (
    <div>
      {text ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      ) : live ? (
        <p className="flex items-center gap-2 text-sm text-grey-600" role="status">
          <WaveDots /> Thinking
          {thinkingFor > 0 && <span className="font-mono text-[11px]">{formatClock(thinkingFor)}</span>}
        </p>
      ) : null}
      {onSkipPlan && (
        <Button variant="ghost" size="sm" className="mt-2 -ml-3.5" onClick={onSkipPlan}>
          Skip, just build it
        </Button>
      )}
      <StepRows steps={record.steps} live={live} open={live || record.status === "needs_fix" || record.status === "error" || record.status === "stopped"} />
      {record.intake && <PlanCard intake={record.intake} actions={plan} />}
      {record.mode === "plan" && record.plan && !record.intake && <PlanDraftCard plan={record.plan} actions={!live ? draft : undefined} />}
      {!live && record.status === "ready" && <DeployCard record={record} chainId={chainId} />}
      {showError && <TurnError record={record} onFix={onFix} disabled={fixDisabled} />}
      {!live && record.status === "stopped" && record.mode === "build" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-grey-600" role="status">
          <span className="size-2 shrink-0 rounded-full bg-grey-400" aria-hidden />
          Stopped. This build&apos;s edits were discarded; your files are as they were.
        </p>
      )}
      {!live && record.review && <ReviewNote record={record} onFix={onSuggest} disabled={fixDisabled} />}
      {!live && !record.review && <VisualCheckNote record={record} checking={checking} failed={checkFailed} onFix={onSuggest} disabled={fixDisabled} />}
      {!live && onSuggest && record.status !== "error" && record.suggestions?.length ? (
        <SuggestionChips items={record.suggestions} onPick={onSuggest} disabled={fixDisabled} />
      ) : null}
      {!live && (record.version || record.chargedMicro > 0) && (
        <p className="mt-2 text-[11px] text-grey-400">
          {record.version ? `Saved as v${record.version}` : ""}
          {record.version && record.chargedMicro > 0 ? " · " : ""}
          {record.chargedMicro > 0 ? `${formatCredits(record.chargedMicro)} of AI` : ""}
        </p>
      )}
    </div>
  );
}
