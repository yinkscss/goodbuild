"use client";

import * as React from "react";
import { Check } from "lucide-react";

import { ActionButton, Button } from "@/components/ui/button";
import { answerText, nextQuestion, PLAN_OTHER_MAX } from "@/lib/plan";
import { paletteById, type Palette } from "@/lib/palettes";
import type { PlanAnswer, PlanIntake, PlanOption, PlanQuestion } from "@/lib/turn-types";
import { cn } from "@/lib/utils";

export interface PlanActions {
  answer: (questionId: string, answer: PlanAnswer) => void;
  start: () => void;
  skip: () => void;
}

const OPTION_CLASS =
  "flex w-full items-start gap-3 rounded-block bg-surface p-3 text-left outline-none transition-colors duration-200 ease-gb hover:bg-tint focus-visible:shadow-focus";

function Recommended() {
  return <span className="rounded-full bg-violet-soft px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-violet">Recommended</span>;
}

function Tick({ on }: { on: boolean }) {
  return (
    <span className={cn("mt-0.5 grid size-5 shrink-0 place-items-center rounded-full", on ? "bg-violet text-white" : "bg-tint text-transparent")} aria-hidden>
      <Check className="size-3" strokeWidth={3} />
    </span>
  );
}

function ChoiceOption({ option, selected, multiple, onClick }: { option: PlanOption; selected: boolean; multiple: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn(OPTION_CLASS, selected && "bg-tint")} onClick={onClick} {...(multiple ? { role: "checkbox", "aria-checked": selected } : { "aria-pressed": selected })}>
      <Tick on={selected} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{option.label}</span>
        {option.detail && <span className="block text-xs text-grey-600">{option.detail}</span>}
      </span>
      {option.recommended && <Recommended />}
    </button>
  );
}

/**
 * A palette drawn as a small piece of the app: its own colours are the point here, so they come in
 * as inline styles. Everything around them is GoodBuild's UI, on DESIGN_SYSTEM tokens.
 */
function PaletteOption({ palette, recommended, selected, onClick }: { palette: Palette; recommended: boolean; selected: boolean; onClick: () => void }) {
  const t = palette.tokens;
  return (
    <button type="button" className={cn("flex w-full flex-col gap-2 rounded-block bg-surface p-2 text-left outline-none transition-colors duration-200 ease-gb hover:bg-tint focus-visible:shadow-focus", selected && "bg-tint")} onClick={onClick} aria-pressed={selected}>
      <span aria-hidden className="block overflow-hidden rounded-[12px]" style={{ background: t.muted, boxShadow: `inset 0 0 0 1px ${t.border}` }}>
        <span className="flex h-7">
          {[t.accent, t.primary, t["muted-foreground"], t.border, t.muted].map((c, i) => (
            <span key={i} className="flex-1" style={{ background: c }} />
          ))}
        </span>
        <span className="block p-2">
        <span className="block rounded-lg p-2" style={{ background: t.card, boxShadow: `inset 0 0 0 1px ${t.border}` }}>
          <span className="block text-sm leading-tight font-semibold" style={{ color: t.foreground }}>
            Aa
          </span>
          <span className="block text-[11px] leading-snug" style={{ color: t["muted-foreground"] }}>
            Your app
          </span>
          <span className="mt-1.5 block w-fit rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ background: t.accent, color: t["accent-foreground"] }}>
            Button
          </span>
        </span>
        </span>
      </span>
      <span className="flex items-start gap-1.5 px-1">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium">{palette.name}</span>
          <span className="block text-xs text-grey-600">{palette.mood}</span>
        </span>
        {selected && (
          <span className="grid size-5 shrink-0 place-items-center rounded-full bg-violet text-white" aria-hidden>
            <Check className="size-3" strokeWidth={3} />
          </span>
        )}
      </span>
      {recommended && (
        <span className="px-1 pb-1">
          <Recommended />
        </span>
      )}
    </button>
  );
}

/** One screen: one question, its options, and always a free-text "Other". */
function QuestionScreen({
  question,
  saved,
  onAnswer,
}: {
  question: PlanQuestion;
  saved?: PlanAnswer;
  onAnswer: (answer: PlanAnswer) => void;
}) {
  const [picked, setPicked] = React.useState<string[]>(saved?.picks ?? []);
  const [other, setOther] = React.useState(saved?.other ?? "");
  const [otherOpen, setOtherOpen] = React.useState(Boolean(saved?.other));
  const otherText = otherOpen ? other.trim() : "";
  const canContinue = picked.length > 0 || Boolean(otherText);
  const single = !question.multiple;

  function pick(id: string) {
    // One choice moves straight on, like Claude Code's plan questions.
    if (single) return onAnswer({ picks: [id] });
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function submit() {
    if (!canContinue) return;
    onAnswer({ picks: single ? [] : picked, ...(otherText ? { other: otherText } : {}) });
  }

  const isPalette = question.kind === "palette";
  return (
    <div className="mt-3">
      <div className={cn(isPalette ? "grid grid-cols-2 gap-2" : "space-y-2")} role="group" aria-label={question.question}>
        {question.options.map((o) => {
          const palette = isPalette ? paletteById(o.id) : undefined;
          return palette ? (
            <PaletteOption key={o.id} palette={palette} recommended={Boolean(o.recommended)} selected={picked.includes(o.id)} onClick={() => pick(o.id)} />
          ) : (
            <ChoiceOption key={o.id} option={o} selected={picked.includes(o.id)} multiple={question.multiple} onClick={() => pick(o.id)} />
          );
        })}
      </div>
      <div className="mt-2">
        <button type="button" className={cn(OPTION_CLASS, otherOpen && "bg-tint")} aria-expanded={otherOpen} onClick={() => setOtherOpen((v) => !v)}>
          <Tick on={otherOpen} />
          <span className="text-sm font-medium">{isPalette ? "Other, describe your own colours" : "Other, tell me in your own words"}</span>
        </button>
        {otherOpen && (
          <input
            autoFocus
            value={other}
            maxLength={PLAN_OTHER_MAX}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            aria-label={isPalette ? "Describe your own colours" : "Your own answer"}
            placeholder={isPalette ? "e.g. our club's green and gold" : "Type your answer"}
            className="mt-2 block w-full rounded-block bg-surface px-3 py-2.5 text-sm outline-none placeholder:text-grey-600 focus-visible:shadow-focus"
          />
        )}
      </div>
      {(!single || otherOpen) && (
        <div className="mt-3 flex justify-end">
          <Button variant="chipSelected" size="sm" disabled={!canContinue} onClick={submit}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

/** What they chose, with the palette's colours beside its name. */
function AnswerList({ intake, onChange }: { intake: PlanIntake; onChange?: (index: number) => void }) {
  return (
    <dl className="space-y-2">
      {intake.questions.map((q, i) => {
        const a = intake.answers[q.id];
        if (!a) return null;
        const palette = q.kind === "palette" && !a.other ? paletteById(a.picks[0]) : undefined;
        return (
          <div key={q.id} className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <dt className="text-xs text-grey-600">{q.label}</dt>
              <dd className="flex flex-wrap items-center gap-1.5 text-sm font-medium break-words">
                {palette && (
                  <span className="flex" aria-hidden>
                    {[palette.tokens.primary, palette.tokens.accent, palette.tokens.muted].map((c) => (
                      <span key={c} className="-mr-1 size-4 rounded-full" style={{ background: c, boxShadow: `inset 0 0 0 1px ${palette.tokens.border}` }} />
                    ))}
                  </span>
                )}
                <span className={palette ? "ml-1 min-w-0" : "min-w-0"}>{answerText(q, a)}</span>
              </dd>
            </div>
            {onChange && (
              <Button variant="ghost" size="sm" className="-mr-1 px-2.5 py-1" aria-label={`Change ${q.label}`} onClick={() => onChange(i)}>
                Change
              </Button>
            )}
          </div>
        );
      })}
    </dl>
  );
}

/** A game's pitch (D92): the planner's best version of their idea, built as the spec. */
function GameIdea({ intake }: { intake: PlanIntake }) {
  const game = intake.game;
  if (!game) return null;
  return (
    <div className="mb-3 rounded-block bg-surface p-3">
      <p className="text-sm font-semibold">{game.name}</p>
      <p className="mt-0.5 text-sm text-grey-600">{game.pitch}</p>
      <dl className="mt-2 grid gap-1 text-xs text-grey-600">
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-ink">You</dt>
          <dd>{game.loop}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-ink">Game over</dt>
          <dd>{game.lose}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 shrink-0 font-medium text-ink">Harder</dt>
          <dd>{game.harder}</dd>
        </div>
        {game.extras.length > 0 && (
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 font-medium text-ink">Extras</dt>
            <dd>{game.extras.join(" · ")}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

/**
 * The plan's questions in the chat (D32): one screen per question, then a short summary and Start
 * building. Answers live on the turn's record, so a reload lands on the first unanswered question
 * and nothing here costs AI or holds a job. Without `actions` it shows what was chosen, read-only.
 */
export function PlanCard({ intake, actions }: { intake: PlanIntake; actions?: PlanActions }) {
  const [viewing, setViewing] = React.useState<number | null>(null);
  const [leaving, setLeaving] = React.useState(false);
  const heading = React.useRef<HTMLHeadingElement>(null);
  const moved = React.useRef(false);
  const total = intake.questions.length;
  const index = viewing ?? nextQuestion(intake);

  // Keyboard and screen reader users land on the new question, not back at the top of the page.
  React.useEffect(() => {
    if (moved.current) heading.current?.focus();
    moved.current = false;
  }, [index]);

  // The chat scrolls to its end on load. On a phone that can hide the first question's heading.
  const active = Boolean(actions);
  React.useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => heading.current?.scrollIntoView?.({ block: "nearest" }), 600);
    return () => clearTimeout(timer);
  }, [active]);

  if (!actions) {
    if (!intake.questions.some((q) => intake.answers[q.id])) return null;
    return (
      <div className="mt-3 rounded-block bg-canvas p-4">
        <p className="mb-2 text-[11px] font-semibold tracking-[.18em] text-violet uppercase">Your plan</p>
        <GameIdea intake={intake} />
        <AnswerList intake={intake} />
      </div>
    );
  }

  const go = (next: number | null) => {
    moved.current = true;
    setViewing(next);
  };
  // Guards a double click. It wears off, because a refused send (the free AI cap) leaves this card up.
  const leave = (fn: () => void) => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => setLeaving(false), 4_000);
    fn();
  };

  if (index >= total) {
    return (
      <div className="mt-3 rounded-block bg-canvas p-4">
        <p className="text-[11px] font-semibold tracking-[.18em] text-violet uppercase">Your plan</p>
        <h3 ref={heading} tabIndex={-1} className="mt-1 mb-3 text-sm font-medium outline-none focus-visible:shadow-none">
          {intake.summary}
        </h3>
        <GameIdea intake={intake} />
        <AnswerList intake={intake} onChange={go} />
        <div className="mt-4 flex justify-end">
          <ActionButton disabled={leaving} onClick={() => leave(actions.start)}>
            Start building
          </ActionButton>
        </div>
      </div>
    );
  }

  const question = intake.questions[index];
  return (
    <div className="mt-3 rounded-block bg-canvas p-4">
      <p className="text-[11px] font-semibold tracking-[.18em] text-violet uppercase">
        Question {index + 1} of {total}
      </p>
      <h3 ref={heading} tabIndex={-1} className="mt-1 text-sm font-semibold outline-none focus-visible:shadow-none">
        {question.question}
      </h3>
      <QuestionScreen
        key={question.id}
        question={question}
        saved={intake.answers[question.id]}
        onAnswer={(answer) => {
          actions.answer(question.id, answer);
          go(null);
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-2">
        {index > 0 ? (
          <Button variant="ghost" size="sm" className="-ml-2" onClick={() => go(index - 1)}>
            Back
          </Button>
        ) : (
          <span />
        )}
        <Button variant="ghost" size="sm" className="-mr-2" disabled={leaving} onClick={() => leave(actions.skip)}>
          Skip, just build it
        </Button>
      </div>
    </div>
  );
}
