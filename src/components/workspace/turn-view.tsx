"use client";

import * as React from "react";
import { ArrowUpRight, Check, ChevronRight, Eye, Hexagon, RotateCw, Wrench } from "lucide-react";

import { DeployButton } from "@/components/deploy/deploy-trigger";
import { Button } from "@/components/ui/button";
import { formatMicroUsd } from "@/lib/pricing";
import type { FileChange, Step, TurnRecord } from "@/lib/turn-types";
import { cn } from "@/lib/utils";

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

export function StepRows({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  return (
    <ol className="mt-3 rounded-block bg-[#FAFAFA] px-4 py-1" aria-label="Build steps">
      {steps.map((s) => (
        <li key={s.id} className="flex items-start gap-3 py-2">
          <StepDot status={s.status} />
          <div className="min-w-0">
            <p className="text-sm font-medium">{s.label}</p>
            {s.detail && <p className="truncate text-xs text-grey-600">{s.detail}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Dark, mono build log (mockup c). Shows the tail; the full log is in the record. */
export function BuildLog({ lines, live }: { lines: string[]; live: boolean }) {
  if (!lines.length) return null;
  const tail = lines.slice(-8);
  return (
    <div className="mt-3 rounded-block bg-ink p-4 font-mono text-[11.5px] leading-[1.7] text-white/80" aria-label="Build log">
      <p className="text-white/40">build log</p>
      {tail.map((l, i) => (
        <p key={i} className={cn("break-all", l.startsWith("✗") && "text-[#ff9aa8]", l.startsWith("!") && "text-[#ffc46b]")}>
          {l}
          {live && i === tail.length - 1 && <span className="ml-0.5 animate-caret motion-reduce:animate-none">▍</span>}
        </p>
      ))}
    </div>
  );
}

/** Collapsed file diffs: chips that expand to a unified diff. */
export function DiffChips({ changes }: { changes: FileChange[] }) {
  const [open, setOpen] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  if (!changes.length) return null;
  const visible = showAll ? changes : changes.slice(0, 2);
  const active = changes.find((c) => c.path === open);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {visible.map((c) => (
          <button
            key={c.path}
            type="button"
            onClick={() => setOpen(open === c.path ? null : c.path)}
            aria-expanded={open === c.path}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-3 py-1.5 outline-none hover:bg-tint focus-visible:shadow-focus",
              open === c.path ? "bg-tint" : "bg-canvas",
            )}
          >
            <ChevronRight className={cn("size-3 transition-transform duration-200 ease-gb", open === c.path && "rotate-90")} />
            <span className="font-mono">{c.path}</span>
            {c.op === "delete" ? (
              <b className="font-semibold text-danger">deleted</b>
            ) : (
              <>
                {c.added > 0 && <b className="font-semibold text-success">+{c.added}</b>}
                {c.removed > 0 && <b className="font-semibold text-danger">−{c.removed}</b>}
              </>
            )}
          </button>
        ))}
        {!showAll && changes.length > 2 && (
          <button type="button" onClick={() => setShowAll(true)} className="rounded-full bg-canvas px-3 py-1.5 hover:bg-tint">
            +{changes.length - 2} files
          </button>
        )}
      </div>
      {active?.diff && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-block bg-canvas p-3 font-mono text-[12px] leading-5">
          {active.diff.split("\n").map((line, i) => (
            <span
              key={i}
              className={cn(
                "block whitespace-pre",
                line.startsWith("+") && "bg-success/10 text-success",
                line.startsWith("-") && "bg-danger/10 text-danger",
                line.startsWith("@@") && "text-grey-400",
              )}
            >
              {line || " "}
            </span>
          ))}
        </pre>
      )}
    </div>
  );
}

/** "Ready to deploy contract" card; the button opens the deploy modal (M5). */
export function DeployCard({ record }: { record: TurnRecord }) {
  const contracts = record.contracts ?? [];
  const main = contracts[0];
  if (!main) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-[20px] bg-tint p-4">
      <span className="grid size-11 place-items-center rounded-block bg-violet text-white" aria-hidden>
        <Hexagon className="size-5" />
      </span>
      <div className="min-w-[60%] flex-1">
        <p className="text-sm font-semibold">Ready to deploy {contracts.map((c) => c.name).join(", ")}</p>
        <p className="text-xs text-grey-600">
          Celo Sepolia · {contracts.length > 1 ? `${contracts.length} contracts, one signature each` : `${(main.bytecodeBytes / 1024).toFixed(1)} kB`} · you sign from your own wallet
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

/** An assistant turn: text, steps, log, diffs, then the deploy card or an error card. */
export function TurnView({
  text,
  record,
  live,
  onFix,
  fixDisabled,
  onSuggest,
  checking,
  checkFailed,
}: {
  text: string;
  record: TurnRecord;
  live: boolean;
  onFix: () => void;
  fixDisabled: boolean;
  /** Set on the latest turn only: shows its suggestion chips. */
  onSuggest?: (prompt: string) => void;
  /** The visual check of this turn's preview is running. */
  checking?: boolean;
  /** The visual check of this turn's preview couldn't produce a result. */
  checkFailed?: boolean;
}) {
  const showError = !live && (record.status === "needs_fix" || record.status === "error");
  return (
    <div>
      {text ? (
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{text}</p>
      ) : live ? (
        <p className="text-sm text-grey-600">Thinking…</p>
      ) : null}
      <StepRows steps={record.steps} />
      <BuildLog lines={record.log} live={live} />
      {!live && <DiffChips changes={record.changes} />}
      {!live && record.status === "ready" && <DeployCard record={record} />}
      {showError && <TurnError record={record} onFix={onFix} disabled={fixDisabled} />}
      {!live && record.status === "stopped" && (
        <p className="mt-3 flex items-center gap-2 text-xs text-grey-600" role="status">
          <span className="size-2 shrink-0 rounded-full bg-grey-400" aria-hidden />
          Stopped. This build&apos;s edits were discarded; your files are as they were.
        </p>
      )}
      {!live && <VisualCheckNote record={record} checking={checking} failed={checkFailed} onFix={onSuggest} disabled={fixDisabled} />}
      {!live && onSuggest && record.status !== "error" && record.suggestions?.length ? (
        <SuggestionChips items={record.suggestions} onPick={onSuggest} disabled={fixDisabled} />
      ) : null}
      {!live && (record.version || record.chargedMicro > 0) && (
        <p className="mt-2 text-[11px] text-grey-400">
          {record.version ? `Saved as v${record.version}` : ""}
          {record.version && record.chargedMicro > 0 ? " · " : ""}
          {record.chargedMicro > 0 ? `${formatMicroUsd(record.chargedMicro)} of AI` : ""}
        </p>
      )}
    </div>
  );
}
