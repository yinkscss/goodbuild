import { game2d } from "./kits/game-2d";
import { answerText } from "@/lib/plan";
import { PALETTES, paletteById } from "@/lib/palettes";
import type { GameBrief, PlanIntake, PlanOption, PlanQuestion, TurnRecord } from "@/lib/turn-types";

import type { ToolSpec } from "./model";

/**
 * Plan first (D32): a project's first message gets a few plain questions before anything is built.
 * This is one call on the cheap tier with thinking off, and a small prompt with no project files.
 * The person's answers need no model at all, and they go into every later turn's context.
 */

/**
 * Output limit for the one call. Five questions of four options fit in about 800 tokens, and a game's
 * brief about 250 more. This also bounds the worst-case charge, which the cap's planning headroom has
 * to cover (PLAN_HEADROOM_MICRO).
 */
export const INTAKE_MAX_TOKENS = 2_000;

const MAX_MODEL_QUESTIONS = 4;
/**
 * A game gets more (D93): how it's played, then obstacles, power-ups and the computer's characters,
 * each on its own card as the owner asked, and one more. The server adds the leaderboard, MiniPay
 * and colours cards, so a game's plan is at most eight one-tap cards.
 */
const MAX_GAME_MODEL_QUESTIONS = 5;
const MAX_OPTIONS = 4;
/** The palette question is added by the server, so the model doesn't spend tokens describing colours. */
const PALETTE_QUESTION_ID = "palette";
/** Games get a MiniPay question from the server too (D88), so it is always asked and always worded the same. */
export const MINIPAY_QUESTION_ID = "minipay";
/** The request already says MiniPay: the kit turns on from its words, so there is nothing to ask. */
const SAYS_MINIPAY = /\bmini ?pay\b/i;
/** Games get a leaderboard card from the server (D93): posting needs a wallet, the owner's decision. */
export const LEADERBOARD_QUESTION_ID = "leaderboard";
/** The request already asks for one: nothing to ask, the plan has one. */
const SAYS_LEADERBOARD = /\b(leader ?boards?|high ?score (?:board|table|list)s?|top scores?|ranking)\b/i;
/** "without a leaderboard", "no leaderboard", "don't need a high score table": then the card is still asked. */
const REFUSES_LEADERBOARD = /\b(no|without|not|don'?t (?:want|need)|skip)\b[\w\s]{0,20}?\b(leader ?boards?|high ?score (?:board|table|list)s?|top scores?|ranking)\b/i;

/** The request already asks for a leaderboard (and doesn't say it wants none). */
const asksLeaderboard = (request: string) => SAYS_LEADERBOARD.test(request) && !REFUSES_LEADERBOARD.test(request);
/** A question about scores or a leaderboard, which the server's card asks instead for a game. */
const ASKS_SCORES = /\b(leader ?boards?|high ?scores?|scores?|rankings?)\b/i;

/** The three parts of a game the owner wants asked one by one (D93), and how to recognise each card. */
export const GAME_PARTS = [
  { id: "obstacles", test: /\b(obstacles?|in (?:the|your|their) way|hazards?|dodge|avoid|traps?|challenges?|blocks? (?:you|the))\b/i },
  { id: "powerups", test: /\b(power[- ]?ups?|boosts?|pick[- ]?ups?|bonus(?:es)?|special items?)\b/i },
  { id: "npcs", test: /\b(npcs?|computer|rivals?|opponents?|enem(?:y|ies)|characters?|bots?|who else|ai (?:cars|players|racers))\b/i },
] as const;
type GamePart = (typeof GAME_PARTS)[number]["id"];

/** Which of the three a card asks about, by its own words (not its options). */
function gamePartOf(q: PlanQuestion): GamePart | undefined {
  const text = `${q.question} ${q.label}`;
  // Power-ups first: "special items that block enemies" is about power-ups.
  for (const id of ["powerups", "npcs", "obstacles"] as const) if (GAME_PARTS.find((p) => p.id === id)!.test.test(text)) return id;
  return undefined;
}

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

/** A game's planner also pitches the game (D93). Only games get the field, so other plans don't pay for it. */
const GAME_BRIEF_FIELD = {
  type: "object",
  description: "Only for a game: your pitch for the best version of it, shown to them before building.",
  properties: {
    name: { type: "string", description: "A catchy name, two or three words." },
    pitch: { type: "string", description: "One sentence a player would want to try." },
    loop: { type: "string", description: "What you do over and over, in a few words: dodge, collect, survive." },
    lose: { type: "string", description: "How a round ends." },
    harder: { type: "string", description: "How it gets harder as you go." },
    extras: { type: "array", items: { type: "string" }, description: "Two or three small extras that make people play again, fitted to this game: near-miss bonus, combo multiplier, daily missions, a ghost of your best run, coins to unlock things by playing." },
  },
  required: ["name", "pitch", "loop", "lose", "harder"],
};

export const INTAKE_TOOLS_GAME: ToolSpec[] = INTAKE_TOOLS.map((tool) => {
  const params = tool.function.parameters as { properties: Record<string, unknown> };
  return { ...tool, function: { ...tool.function, parameters: { ...tool.function.parameters, properties: { ...params.properties, game_brief: GAME_BRIEF_FIELD } } } };
});

/** The planner's tools for this request. */
export function intakeTools(request: string): ToolSpec[] {
  return isGameRequest(request) ? INTAKE_TOOLS_GAME : INTAKE_TOOLS;
}

export const INTAKE_PROMPT = `You are GoodBuild's planner. GoodBuild turns a description into a working app on Celo, a game or a plain website. Someone just described what they want. Before anything is built, ask a few quick questions so the first build is right. Most users are students and newcomers to crypto in Nigeria and across Africa, and many use G$ (GoodDollar).

Write one short friendly sentence, then call ask_questions once. Do nothing else.

The questions:
- 2 to 4 questions, only ones whose answer changes what gets built. Never ask something they already told you.
- Everyday words. Ask what people should be able to do (send, withdraw, vote), who can do it, and how much. Never use technical words like ERC-20, token standard, contract function, modifier, mapping, gas, ABI, deploy or wallet address.
- Each question has 2 to 4 short, concrete options that fit this request, and exactly one is marked recommended. An "Other" box is added for you, so don't write one.
- Set multiple to true when several options can apply together.
- Ask only about the kind of thing it is. Money or ownership on Celo (payments, savings, tickets, votes): what people can do with the money, who, how much. A regular app with no money (bookings, lists, sign-ups, a quiz): what people do in it, what it remembers for them, who sees what (offer "Only me, the owner" for forms sent to them, never a passcode). A plain website: the main thing visitors do, its sections, its tone. Never ask an app without money about money, tokens, voting or wallets.
- A game: follow the game rules that come with their message.
- Don't ask about colours, GoodBuild adds that question itself. For a game, don't ask about MiniPay either: GoodBuild adds that one too. Set recommended_palette to the one that suits the app: ${PALETTES.map((p) => `${p.id} (${p.mood.toLowerCase()})`).join("; ")}. Use "none" only if they already named their colours.
- Never ask about the network, pricing or how the code is written.
- Never use em dashes.

Example for "a savings circle for my friends":
"What should people be able to do?" (multiple): Put money in / Take their turn to collect / See who has paid
"How often does everyone pay in?": Every week (recommended) / Every month
"Who can start a new round?": Only me (recommended) / Anyone in the group

Example for "a booking page for my salon": "What should customers be able to do?" (multiple): Pick a time (recommended) / Choose a style / Leave a phone number

If the message is only a question and not something to build, answer it in a sentence or two and don't call the tool. A skill game with an entry fee is fine. If it asks for sports betting, a game of chance for money (lottery, dice, slots), taking people's money without consent or anything illegal, say briefly that you can't build that, suggest a legitimate alternative, and don't call the tool.`;

/**
 * The game rules (D93), sent only with a game's request so other plans don't pay for them: obstacles,
 * power-ups and the computer's characters each get their own card, and the planner pitches the game.
 */
export const GAME_RULES = `Game rules: up to 5 questions. Unless they already said, ask how it's played (the controls). Then ALWAYS ask these three, each as its own question with multiple set to true and 3 or 4 options that fit THIS game: what gets in the player's way (obstacles and challenges), which power-ups there are, and who else is in the game, controlled by the computer (rivals, enemies, traffic, a boss). For a car racer that could be: oncoming traffic, slower cars to overtake, oil slicks, road works closing a lane / nitro boost, shield, coin magnet, slow motion / rival racers who block you, police who chase you, just traffic. Use a fifth question only for something they asked for that needs a choice (what the store sells, how a season pass rewards players). Don't ask about scores or a leaderboard: GoodBuild adds that question. Also fill game_brief: name it, pitch the best version of their idea, and pick extras that make it more fun than what they asked for.

Example for "a jumping game with a monkey" (multiple on the last three): "How do you play?": Tap to jump (recommended) / Tap and hold for a bigger jump. "What gets in the monkey's way?": Gaps between trees (recommended) / Falling coconuts / Snakes on branches. "Which power-ups?": Banana magnet (recommended) / Double jump / Shield. "Who else is in the jungle?": Birds that swoop at you (recommended) / A rival monkey racing you / Nobody, just you.`;

/** The whole context of the planning call: the request, a note that files came with it, and for a game its rules. */
export function intakeContext(request: string, assets: { kind: string; name: string }[]): string {
  const uploads = assets.length ? `\n\nThey also uploaded: ${assets.map((a) => `${a.name} (${a.kind})`).join(", ")}.` : "";
  const game = isGameRequest(request) ? `\n\n${GAME_RULES}` : "";
  return `Their message:\n${request}${uploads}${game}`;
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

function parseQuestions(raw: unknown, max = MAX_MODEL_QUESTIONS, game = false): PlanQuestion[] {
  if (!Array.isArray(raw)) return [];
  const questions: PlanQuestion[] = [];
  for (const q of raw) {
    const entry = (q ?? {}) as { question?: unknown; label?: unknown; multiple?: unknown; options?: unknown };
    const question = clean(entry.question, 160);
    const options = parseOptions(entry.options);
    // The palette card already asks about colour, and the MiniPay card about MiniPay.
    if (!question || options.length < 2 || /\b(colou?rs?|palette)\b/i.test(question) || SAYS_MINIPAY.test(question)) continue;
    // A game's scores are the leaderboard card's, which the server asks.
    if (game && ASKS_SCORES.test(question)) continue;
    questions.push({ id: `q${questions.length + 1}`, kind: "choice", question, label: clean(entry.label, 32) || question.slice(0, 32), multiple: entry.multiple === true, options });
    if (questions.length === max) break;
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

/**
 * "Should your game work inside MiniPay?" (D88). Yes turns the mini-app kit on for the build (see
 * planBrief's miniPay), which brings MiniPay's rules, its checklist and the footer its listing needs.
 * The No label never says MiniPay, so the kit's own keywords can't turn it on from that answer.
 */
export function miniPayQuestion(): PlanQuestion {
  return {
    id: MINIPAY_QUESTION_ID,
    kind: "choice",
    question: "Should your game work inside MiniPay, the wallet app on many phones?",
    label: "MiniPay",
    multiple: false,
    options: [
      { id: "yes", label: "Yes, make it MiniPay ready", detail: "It still works in any browser", recommended: true },
      { id: "no", label: "No, just the web", detail: "Any browser, nothing extra" },
    ],
  };
}

/**
 * Ask the MiniPay question: a game, unless they already said MiniPay. Wider than the game kit's
 * words, so 3D games and "a jumping game where..." are asked too; a website about a game isn't.
 */
export function asksMiniPay(request: string): boolean {
  return isGameRequest(request) && !SAYS_MINIPAY.test(request);
}

/** A choice card with fixed wording, the first option recommended. */
function fixedChoice(id: string, label: string, question: string, multiple: boolean, options: string[]): PlanQuestion {
  return { id, kind: "choice", label, question, multiple, options: options.map((text, i) => ({ id: `o${i + 1}`, label: text, ...(i === 0 ? { recommended: true } : {}) })) };
}

/** Generic cards for a game part the model didn't ask about, worded to fit any game. */
const GAME_PART_CARDS: Record<GamePart, () => PlanQuestion> = {
  obstacles: () => fixedChoice("obstacles", "Obstacles", "What should get in the player's way?", true, ["Things to dodge", "Gaps or drops to jump", "Moving hazards", "A clock running out"]),
  powerups: () => fixedChoice("powerups", "Power-ups", "Which power-ups should there be?", true, ["A shield", "A speed boost", "A coin magnet", "An extra life"]),
  npcs: () => fixedChoice("npcs", "Characters", "Who else is in the game, controlled by the computer?", true, ["Rivals who compete with you", "Enemies who chase you", "Crowds or traffic to get past", "Nobody, just the player"]),
};

/**
 * Obstacles, power-ups and the computer's characters each get a card (D93): the model's when it asked,
 * a generic one when it didn't. Its other cards come after them and are dropped first to keep five.
 */
function withGameParts(questions: PlanQuestion[]): PlanQuestion[] {
  const parts = new Map<GamePart, PlanQuestion>();
  const rest: PlanQuestion[] = [];
  for (const q of questions) {
    const part = gamePartOf(q);
    if (part && !parts.has(part)) parts.set(part, { ...q, multiple: true });
    else rest.push(q);
  }
  for (const { id } of GAME_PARTS) if (!parts.has(id)) parts.set(id, GAME_PART_CARDS[id]());
  // How it's played (usually the model's first card) stays first.
  const [first, ...others] = rest;
  const ordered = [...(first ? [first] : []), ...GAME_PARTS.map((p) => parts.get(p.id)!), ...others];
  return ordered.slice(0, MAX_GAME_MODEL_QUESTIONS);
}

/** "Should there be a leaderboard?" (D93). Yes means posting a score needs a wallet; playing never does. */
export function leaderboardQuestion(): PlanQuestion {
  return {
    id: LEADERBOARD_QUESTION_ID,
    kind: "choice",
    question: "Should there be a leaderboard everyone can see?",
    label: "Leaderboard",
    multiple: false,
    options: [
      { id: "yes", label: "Yes, players post scores with their wallet", detail: "Playing stays free, no wallet needed", recommended: true },
      { id: "no", label: "No, each player keeps their own best", detail: "Saved on their phone" },
    ],
  };
}

function parseGameBrief(raw: unknown): GameBrief | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const b = raw as Record<string, unknown>;
  const brief: GameBrief = {
    name: clean(b.name, 40),
    pitch: clean(b.pitch, 200),
    loop: clean(b.loop, 80),
    lose: clean(b.lose, 120),
    harder: clean(b.harder, 120),
    extras: (Array.isArray(b.extras) ? b.extras : []).map((e) => clean(e, 100)).filter(Boolean).slice(0, 3),
  };
  return brief.name && brief.pitch ? brief : undefined;
}

/** A game, for the plan: the game kit's words, or "game" in a request that isn't a website. */
export function isGameRequest(request: string): boolean {
  return looksLikeGame(request) || (/\bgames?\b/i.test(request) && !looksLikeWebsite(request));
}

/** The tool call as a question set, or null when it gives nothing usable (the caller then falls back). */
export function parseIntake(rawArguments: string, request: string): PlanIntake | null {
  let args: { summary?: unknown; questions?: unknown; recommended_palette?: unknown; game_brief?: unknown };
  try {
    args = JSON.parse(rawArguments || "{}") as typeof args;
  } catch {
    return null;
  }
  const game = isGameRequest(request);
  // With the MiniPay card added, an app gets one card fewer from the model, so it's never more than five.
  // A game's cards are counted on their own (D93): five from the model, then leaderboard, MiniPay, colours.
  const miniPay = asksMiniPay(request);
  let questions = parseQuestions(args.questions, game ? MAX_GAME_MODEL_QUESTIONS : miniPay ? MAX_MODEL_QUESTIONS - 1 : MAX_MODEL_QUESTIONS, game);
  if (!questions.length) return null;
  if (game) questions = withGameParts(questions);
  const saidBoard = game && asksLeaderboard(request);
  const palette = clean(args.recommended_palette, 20).toLowerCase();
  const all = [...questions, ...(game && !saidBoard ? [leaderboardQuestion()] : []), ...(miniPay ? [miniPayQuestion()] : [])];
  const brief = game ? parseGameBrief(args.game_brief) : undefined;
  return {
    summary: clean(args.summary, 240) || clean(request, 240),
    questions: palette === "none" ? all : [...all, paletteQuestion(palette, looksLikeWebsite(request))],
    answers: {},
    ...(brief ? { game: brief } : {}),
    ...(saidBoard ? { leaderboard: true } : {}),
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
  const choice = fixedChoice;
  const game = isGameRequest(request);
  const saidBoard = game && asksLeaderboard(request);
  const questions = game
    ? [
        choice("q1", "How to play", "How should people play?", false, ["One tap or click", "Move left and right", "Answer questions"]),
        ...GAME_PARTS.map((p) => GAME_PART_CARDS[p.id]()),
        ...(saidBoard ? [] : [leaderboardQuestion()]),
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
  const miniPay = asksMiniPay(request) ? [miniPayQuestion()] : [];
  return { summary: clean(request, 240), questions: [...questions, ...miniPay, paletteQuestion(PALETTES[0].id, website)], answers: {}, ...(saidBoard ? { leaderboard: true } : {}) };
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
  /** They picked Yes on the MiniPay question (D88): the mini-app kit goes on. */
  miniPay?: boolean;
  /** A game with a leaderboard (D93): with MiniPay, the leaderboard contract kit goes on too. */
  leaderboard?: boolean;
}

/**
 * The person's answers as a context block, kept for every later turn: the rolling memory only sees
 * message text, and answers live on the record. On the first build the theme is locked, because the
 * design rules would otherwise have the model choose its own accent.
 */
export function planBrief(intake: PlanIntake | null, firstBuild: boolean): PlanBrief {
  const answered = intake?.questions.filter((q) => intake.answers[q.id]) ?? [];
  if (!intake || (!answered.length && !intake.game && !intake.leaderboard)) return { text: "", answerWords: "" };
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
  const miniPayAnswer = intake.answers[MINIPAY_QUESTION_ID];
  const miniPay = Boolean(miniPayAnswer?.picks.includes("yes"));
  if (miniPay) lines.push(`- MiniPay: it must work inside MiniPay. The mini-app kit is on: follow its guide and its checklist.`);
  const boardAnswer = intake.answers[LEADERBOARD_QUESTION_ID];
  const leaderboard = intake.leaderboard === true || Boolean(boardAnswer?.picks.includes("yes"));
  if (leaderboard) {
    lines.push(
      `- Leaderboard: yes. Playing is free with no wallet; posting a score asks for the wallet. Use the game kit's useLeaderboard, Leaderboard and PostScore and add its data rule${miniPay ? ". In MiniPay scores go to the leaderboard contract: its kit is on, follow its guide" : ""}.`,
    );
  } else if (boardAnswer?.picks.includes("no")) {
    lines.push(`- Leaderboard: no. Keep each player's best on their device (saveBest).`);
  }
  const game = intake.game;
  if (game) {
    lines.push(
      `- The game idea they saw before building, to build as the spec: "${game.name}". ${game.pitch} Loop: ${game.loop}. A round ends when ${game.lose.replace(/^when\s+/i, "")}. It gets harder: ${game.harder}.${game.extras.length ? ` Extras: ${game.extras.join("; ")}.` : ""}`,
    );
  }
  const unanswered = intake.questions.length - answered.length;
  const tail = unanswered ? `\nThey skipped the other ${unanswered === 1 ? "question" : `${unanswered} questions`}: pick sensible defaults yourself.` : "";
  return {
    text: `The plan they agreed before building. These are their own answers, so follow them and don't ask again. They still apply unless a later message changes them.\nWhat you understood: ${intake.summary}\n${lines.join("\n")}${tail}`,
    answerWords: answered.map((q) => answerText(q, intake.answers[q.id])).join("\n"),
    ...(palette ? { paletteId: palette.id } : {}),
    ...(customColours ? { customColours } : {}),
    ...(miniPay ? { miniPay } : {}),
    ...(leaderboard ? { leaderboard } : {}),
  };
}
