import { game2d } from "./kits/game-2d";
import { answerText } from "@/lib/plan";
import { PALETTES, paletteById } from "@/lib/palettes";
import type { PlanIntake, PlanOption, PlanQuestion, TurnRecord } from "@/lib/turn-types";

import type { ToolSpec } from "./model";

/**
 * Plan first (D32): a project's first message gets a few plain questions before anything is built.
 * This is one call on the cheap tier with thinking off, and a small prompt with no project files.
 * The person's answers need no model at all, and they go into every later turn's context.
 */

/**
 * Output limit for the one call. Five questions of four options fit in about 800 tokens. This also
 * bounds the worst-case charge, which the cap's planning headroom has to cover (PLAN_HEADROOM_MICRO).
 */
export const INTAKE_MAX_TOKENS = 1_500;

const MAX_MODEL_QUESTIONS = 4;
const MAX_OPTIONS = 4;
/** The palette question is added by the server, so the model doesn't spend tokens describing colours. */
const PALETTE_QUESTION_ID = "palette";

export const INTAKE_TOOLS: ToolSpec[] = [
  {
    type: "function",
    function: {
      name: "ask_questions",
      description: "Show the user your questions as clickable cards. Call it once.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "One plain sentence: what you understood they want." },
          questions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                question: { type: "string" },
                label: { type: "string", description: "One to three words naming the question, for a summary list." },
                multiple: { type: "boolean", description: "True when several options can apply together." },
                options: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string" },
                      detail: { type: "string", description: "Optional, a few words." },
                      recommended: { type: "boolean", description: "Exactly one option in each question." },
                    },
                    required: ["label"],
                  },
                },
              },
              required: ["question", "label", "options"],
            },
          },
          recommended_palette: { type: "string", description: `Which colours suit this app: ${PALETTES.map((p) => p.id).join(", ")}. Or "none" if they already named their colours.` },
        },
        required: ["summary", "questions", "recommended_palette"],
      },
    },
  },
];

export const INTAKE_PROMPT = `You are GoodBuild's planner. GoodBuild turns a description into a working app on Celo, a game or a plain website. Someone just described what they want. Before anything is built, ask a few quick questions so the first build is right. Most users are students and newcomers to crypto in Nigeria and across Africa, and many use G$ (GoodDollar).

Write one short friendly sentence, then call ask_questions once. Do nothing else.

The questions:
- 2 to 4 questions, only ones whose answer changes what gets built. Never ask something they already told you.
- Everyday words. Ask what people should be able to do (send, withdraw, vote), who can do it, and how much. Never use technical words like ERC-20, token standard, contract function, modifier, mapping, gas, ABI, deploy or wallet address.
- Each question has 2 to 4 short, concrete options that fit this request, and exactly one is marked recommended. An "Other" box is added for you, so don't write one.
- Set multiple to true when several options can apply together.
- Ask only about the kind of thing it is. Money or ownership on Celo (payments, savings, tickets, votes): what people can do with the money, who, how much. A regular app with no money (bookings, lists, sign-ups, a quiz): what people do in it, what it remembers for them, who sees what (offer "Only me, the owner" for forms sent to them, never a passcode). A game: how it is played, how you win, and scores. A plain website: the main thing visitors do, its sections, its tone. Never ask an app without money about money, tokens, voting or wallets.
- Don't ask about colours, GoodBuild adds that question itself. Set recommended_palette to the one that suits the app: ${PALETTES.map((p) => `${p.id} (${p.mood.toLowerCase()})`).join("; ")}. Use "none" only if they already named their colours.
- Never ask about the network, pricing or how the code is written.
- Never use em dashes.

Example for "a savings circle for my friends":
"What should people be able to do?" (multiple): Put money in / Take their turn to collect / See who has paid
"How often does everyone pay in?": Every week (recommended) / Every month
"Who can start a new round?": Only me (recommended) / Anyone in the group

Example for "a booking page for my salon": "What should customers be able to do?" (multiple): Pick a time (recommended) / Choose a style / Leave a phone number

If the message is only a question and not something to build, answer it in a sentence or two and don't call the tool. A skill game with an entry fee is fine. If it asks for sports betting, a game of chance for money (lottery, dice, slots), taking people's money without consent or anything illegal, say briefly that you can't build that, suggest a legitimate alternative, and don't call the tool.`;

/** The whole context of the planning call: the request, and a note that files came with it. */
export function intakeContext(request: string, assets: { kind: string; name: string }[]): string {
  const uploads = assets.length ? `\n\nThey also uploaded: ${assets.map((a) => `${a.name} (${a.kind})`).join(", ")}.` : "";
  return `Their message:\n${request}${uploads}`;
}

/** No em dashes in what people read, and no runaway lengths from a cheap model. */
function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s*—\s*/g, ", ").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseOptions(raw: unknown): PlanOption[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const options: PlanOption[] = [];
  let marked = -1;
  for (const o of raw) {
    // Cheap models sometimes send plain strings instead of objects.
    const entry = (typeof o === "string" ? { label: o } : (o ?? {})) as { label?: unknown; detail?: unknown; recommended?: unknown };
    const label = clean(entry.label, 80);
    if (!label || /^other\b/i.test(label) || seen.has(label.toLowerCase())) continue;
    seen.add(label.toLowerCase());
    const detail = clean(entry.detail, 100);
    options.push({ id: `o${options.length + 1}`, label, ...(detail ? { detail } : {}) });
    if (entry.recommended === true && marked < 0) marked = options.length - 1;
    if (options.length === MAX_OPTIONS) break;
  }
  // Exactly one recommended, whatever came back.
  return options.map((o, i) => (i === Math.max(0, marked) ? { ...o, recommended: true } : o));
}

function parseQuestions(raw: unknown): PlanQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: PlanQuestion[] = [];
  for (const q of raw) {
    const entry = (q ?? {}) as { question?: unknown; label?: unknown; multiple?: unknown; options?: unknown };
    const question = clean(entry.question, 160);
    const options = parseOptions(entry.options);
    // The palette card already asks about colour.
    if (!question || options.length < 2 || /\b(colou?rs?|palette)\b/i.test(question)) continue;
    questions.push({ id: `q${questions.length + 1}`, kind: "choice", question, label: clean(entry.label, 32) || question.slice(0, 32), multiple: entry.multiple === true, options });
    if (questions.length === MAX_MODEL_QUESTIONS) break;
  }
  return questions;
}

function paletteQuestion(recommended: string, website: boolean): PlanQuestion {
  const first = paletteById(recommended)?.id ?? PALETTES[0].id;
  const ordered = [...PALETTES.filter((p) => p.id === first), ...PALETTES.filter((p) => p.id !== first)];
  return {
    id: PALETTE_QUESTION_ID,
    kind: "palette",
    question: website ? "Which colours feel right for your site?" : "Which colours feel right for your app?",
    label: "Colours",
    multiple: false,
    options: ordered.map((p, i) => ({ id: p.id, label: p.name, detail: p.mood, ...(i === 0 ? { recommended: true } : {}) })),
  };
}

/** The tool call as a question set, or null when it gives nothing usable (the caller then falls back). */
export function parseIntake(rawArguments: string, request: string): PlanIntake | null {
  let args: { summary?: unknown; questions?: unknown; recommended_palette?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}") as typeof args;
  } catch {
    return null;
  }
  const questions = parseQuestions(args.questions);
  if (!questions.length) return null;
  const palette = clean(args.recommended_palette, 20).toLowerCase();
  return {
    summary: clean(args.summary, 240) || clean(request, 240),
    questions: palette === "none" ? questions : [...questions, paletteQuestion(palette, looksLikeWebsite(request))],
    answers: {},
  };
}

/** A game by its words (the same test that turns on the game-2d kit). */
export function looksLikeGame(request: string): boolean {
  return game2d.keywords.test(request);
}

export function looksLikeWebsite(request: string): boolean {
  return /\b(web ?sites?|landing page|portfolio|blog|about page|home ?page|site for)\b/i.test(request) && !/\b(contract|token|tip|pay|vote|voting|savings?|G\$|mint|nft)\b/i.test(request);
}

/**
 * For a model reply with no usable tool call: fixed questions, so the person still gets a plan
 * and we don't pay for a second try. Worded to fit anything.
 */
export function fallbackIntake(request: string): PlanIntake {
  const website = looksLikeWebsite(request);
  const choice = (id: string, label: string, question: string, multiple: boolean, options: string[]): PlanQuestion => ({
    id,
    kind: "choice",
    label,
    question,
    multiple,
    options: options.map((text, i) => ({ id: `o${i + 1}`, label: text, ...(i === 0 ? { recommended: true } : {}) })),
  });
  const game = looksLikeGame(request);
  const questions = game
    ? [
        choice("q1", "How to play", "How should people play?", false, ["One tap or click", "Move left and right", "Answer questions"]),
        choice("q2", "Scores", "What should happen with scores?", false, ["Keep my own best score", "A leaderboard everyone can see"]),
      ]
    : website
    ? [
        choice("q1", "Main action", "What's the main thing visitors should do?", false, ["Learn what this is", "Get in touch", "Sign up or join"]),
        choice("q2", "Tone", "How should it sound?", false, ["Friendly and simple", "Professional", "Bold and exciting"]),
      ]
    : [
        choice("q1", "Who it's for", "Who will use this?", false, ["A small group I know", "My school or community", "Anyone who finds it"]),
        choice("q2", "Who's in charge", "Who should be able to change things or take money out?", false, ["Only me", "A few people I choose", "Everyone decides together"]),
      ];
  return { summary: clean(request, 240), questions: [...questions, paletteQuestion(PALETTES[0].id, website)], answers: {} };
}

/** The newest question set in a project's chat, if any. */
export function latestIntake(rows: Array<{ role: string; meta: unknown }>): PlanIntake | null {
  for (const m of [...rows].reverse()) {
    const intake = m.role === "assistant" ? (m.meta as TurnRecord | null)?.intake : undefined;
    if (intake) return intake;
  }
  return null;
}

export interface PlanBrief {
  /** The block for the context message. Empty when there are no answers to carry. */
  text: string;
  /** The person's words in their answers, for the G$ and CELO checks. */
  answerWords: string;
  /** A curated palette they picked. */
  paletteId?: string;
  /** Colours they described themselves. */
  customColours?: string;
}

/**
 * The person's answers as a context block, kept for every later turn: the rolling memory only sees
 * message text, and answers live on the record. On the first build the theme is locked, because the
 * design rules would otherwise have the model choose its own accent.
 */
export function planBrief(intake: PlanIntake | null, firstBuild: boolean): PlanBrief {
  const answered = intake?.questions.filter((q) => intake.answers[q.id]) ?? [];
  if (!intake || !answered.length) return { text: "", answerWords: "" };
  const lines = answered.filter((q) => q.kind === "choice").map((q) => `- ${q.question} ${answerText(q, intake.answers[q.id])}`);
  const colourQuestion = answered.find((q) => q.kind === "palette");
  const colourAnswer = colourQuestion ? intake.answers[colourQuestion.id] : undefined;
  const palette = colourAnswer?.other ? undefined : paletteById(colourAnswer?.picks[0]);
  const customColours = colourAnswer?.other;
  if (palette) {
    lines.push(
      firstBuild
        ? `- Colours: they chose "${palette.name}". It is already set in the @theme block of public/index.html and GoodBuild keeps it there. Use the token classes and don't change any --color-* value on this build, whatever the design rules say about picking an accent.`
        : `- Colours: they chose "${palette.name}" at the start. Keep it unless they ask for a change.`,
    );
  } else if (customColours) {
    lines.push(`- Colours, in their words: "${customColours}". Set the --color-* tokens in public/index.html to match, with text that stays easy to read on its background.`);
  }
  const unanswered = intake.questions.length - answered.length;
  const tail = unanswered ? `\nThey skipped the other ${unanswered === 1 ? "question" : `${unanswered} questions`}: pick sensible defaults yourself.` : "";
  return {
    text: `The plan they agreed before building. These are their own answers, so follow them and don't ask again. They still apply unless a later message changes them.\nWhat you understood: ${intake.summary}\n${lines.join("\n")}${tail}`,
    answerWords: answered.map((q) => answerText(q, intake.answers[q.id])).join("\n"),
    ...(palette ? { paletteId: palette.id } : {}),
    ...(customColours ? { customColours } : {}),
  };
}
