// TypeSafe System One questions are evaluated independently against the same state.
import { createHash } from "node:crypto";
import { KIND_LABEL, type ContractKind } from "../../lib/contract-kind";
import { z } from "zod";

export const features = {
  game: "a playable game",
  website: "a primarily informational website",
  multiplayer: "participation by multiple human players in the same activity",
  wallet: "visitors connecting a crypto wallet",
  payments: "new or changed on-chain functionality",
  integrations: "saved data, authentication or an external service integration",
  miniPay: "support inside the MiniPay wallet",
  leaderboard: "a public score ranking",
  shop: "an in-game store",
  threeD: "an interactive three-dimensional scene",
  vault: "a shared on-chain vault or governance system",
  dashboard: "a dashboard",
  motion: "animated transitions",
  gd: "transactions using GoodDollar (G$)",
  native: "transactions using the native CELO asset",
  ticTacToe: "a three-by-three noughts and crosses game",
  puzzle: "a puzzle game such as matching, sliding, word or number puzzles",
  turnBased: "a game played in turns or rounds, such as quizzes, trivia, card games or board games",
  advance: "advancing to the next saved milestone",
} as const;
export type Feature = keyof typeof features;
export type Intent = "requested" | "excluded" | "unspecified" | "unclear";
export type IntentState = { request: string; goal?: string; answers?: string; firstBuild?: boolean; files?: string[] };
type Question =
  { type: "noul"; instructions: string } | { type: "choice"; instructions: string; criteria: Record<string, string> };
export const questions: Record<string, Question> = {
  kind: { type: "choice", instructions: "Which category best describes the original project goal?", criteria: KIND_LABEL },
  knownKind: { type: "noul", instructions: "Does a specific named category in the project catalog fit the original goal?" },
};
questions.knownKind.instructions +=
  " Categories: " +
  Object.values(KIND_LABEL)
    .filter((label) => label !== KIND_LABEL.custom)
    .join(", ");
for (const [id, meaning] of Object.entries(features)) {
  const focus =
    "Use the latest request and explicit answers. On the first build include the goal. On later edits distinguish new work from existing background. Words that are only quoted text, labels being renamed, or the topic of a page do not count as asking for the capability.";
  questions[id] = { type: "noul", instructions: `Does the user ask for ${meaning} in this turn? ${focus}` };
  questions[id + "_excluded"] = {
    type: "noul",
    instructions: `Does the user explicitly rule out ${meaning} in this turn? ${focus}`,
  };
}
export const questionVersion = createHash("sha256").update(JSON.stringify(questions)).digest("hex");
/**
 * Shadow-only signals (D173): asked only under JEV_ROUTING=shadow, recorded on the message, never acted on.
 * One yes/no question each (no "_excluded" twin), so they add about half what a capability does. They measure the
 * gaps real prompts showed: things GoodBuild can't build yet, and first messages too vague to build.
 */
export const shadowSignals = {
  photoInput: "Does the user want the app's own users to take or upload a photo that the app then reads or acts on, such as reading a receipt?",
  inAppAi: "Does the user want artificial intelligence inside the finished app, such as a chatbot, an AI assistant, AI-written content or an AI game master?",
  reminders: "Does the user want the app to send reminders or notifications later, by push, text message, email or alarm?",
  roles: "Does the user describe two or more kinds of users with different abilities, such as buyers and sellers, couriers and customers, or admins and members?",
  liveMultiplayer: "Does the user want people to see each other's actions live, at the same moment, in real time?",
  outOfScope: "Is the request for something other than a web app, website or browser game, such as a native phone app, a backend service on its own, a trading bot or changes to an existing codebase elsewhere?",
  vague: "Is the latest request too vague to build: it asks what to build, asks for ideas, or names no specific app, purpose or feature?",
} as const;
export type ShadowSignal = keyof typeof shadowSignals;
const shadowQuestions: Record<string, Question> = Object.fromEntries(
  Object.entries(shadowSignals).map(([id, instructions]) => ["shadow_" + id, { type: "noul", instructions }]),
);
/** The question set a shadow call sends: the live one plus the shadow signals. Its own hash, so #190's stays as it was. */
export const shadowQuestionVersion = createHash("sha256").update(JSON.stringify({ ...questions, ...shadowQuestions })).digest("hex");
export const thresholds = { high: 0.4, low: 0.3 }; // provisional: tuned on 25 cases, checked on 70 held-out ones (D172)
const probability = z.number().min(0).max(1);
export const responseSchema = z.object({
  model: z.string().min(1),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
  answers: z.record(
    z.string(),
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("noul"), noul: probability }),
      z.object({
        type: z.literal("choice"),
        choice: z.string(),
        confidence: probability.nullable(),
        probabilities: z.record(z.string(), probability),
      }),
    ]),
  ),
});
export type JevResponse = z.infer<typeof responseSchema>;
function noul(response: JevResponse, key: string) {
  const answer = response.answers[key];
  if (answer?.type !== "noul") throw new Error("Incomplete Jev classification: " + key);
  return answer.noul;
}
export function resolveAnswers(response: JevResponse, limits = thresholds) {
  const signals = {} as Record<Feature, Intent>;
  for (const id of Object.keys(features) as Feature[]) {
    const yes = noul(response, id),
      no = noul(response, id + "_excluded");
    signals[id] =
      yes >= limits.high && no <= limits.low
        ? "requested"
        : no >= limits.high && yes <= limits.low
          ? "excluded"
          : yes <= limits.low && no <= limits.low
            ? "unspecified"
            : "unclear";
  }
  return signals;
}
export type JevDecision = {
  version: string;
  revision: string;
  model: string;
  signals: Record<Feature, Intent>;
  response: JevResponse;
  displayKind: ContractKind;
  relevantFiles: string[];
  ms: number;
  chargedMicro?: number;
  /** Shadow signals' probabilities, when the call asked them (JEV_ROUTING=shadow only). */
  shadow?: Partial<Record<ShadowSignal, number>>;
  /** Set when a button turn reused an earlier message's decision (D173): the id of that message. */
  reusedFrom?: string;
};
export async function classifyTurn(
  state: IntentState,
  signal?: AbortSignal,
  env: Record<string, string | undefined> = process.env,
  opts: { shadow?: boolean } = {},
): Promise<JevDecision> {
  if (!env.TYPESAFE_API_KEY) throw new Error("Jev classification requires TYPESAFE_API_KEY");
  const start = Date.now();
  const timeout = AbortSignal.timeout(15000);
  const batched = { ...questions, ...(opts.shadow ? shadowQuestions : {}) };
  for (const [index, path] of (state.files ?? []).entries()) {
    batched["file_" + index] = {
      type: "noul",
      instructions: `Is the existing file ${JSON.stringify(path)} relevant to implementing the current request?`,
    };
  }
  const result = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.TYPESAFE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.JEV_MODEL || "jev-latest", state, questions: batched }),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!result.ok) throw new Error(`Jev classification failed (HTTP ${result.status})`);
  const response = responseSchema.parse(await result.json());
  const kind = response.answers.kind;
  if (kind?.type !== "choice" || !Object.hasOwn(KIND_LABEL, kind.choice)) throw new Error("Invalid Jev project category");
  const fit = noul(response, "knownKind");
  const displayKind =
    fit >= thresholds.high && (kind.confidence ?? 0) >= thresholds.high ? (kind.choice as ContractKind) : "custom";
  const relevantFiles = (state.files ?? []).filter((_, index) => noul(response, "file_" + index) >= thresholds.high);
  const shadow = opts.shadow
    ? // Read leniently: a missing shadow answer must never lose the rest of the shadow record (D173).
      (Object.fromEntries(
        Object.keys(shadowSignals).flatMap((id) => {
          const answer = response.answers["shadow_" + id];
          return answer?.type === "noul" ? [[id, answer.noul]] : [];
        }),
      ) as Partial<Record<ShadowSignal, number>>)
    : undefined;
  return {
    ...(shadow ? { shadow } : {}),
    displayKind,
    relevantFiles,
    version: opts.shadow ? shadowQuestionVersion : questionVersion,
    revision: createHash("sha256").update(JSON.stringify(state)).digest("hex"),
    model: response.model,
    response,
    signals: resolveAnswers(response),
    ms: Date.now() - start,
  };
}
const CONTINUE = /^(continue|continue building|build next|next milestone)[.!]?$/i;
/** The plain words that mean "go on to the next milestone". */
export function isContinuation(text: string) {
  return CONTINUE.test(text.trim());
}
export function wants(decision: JevDecision | undefined, feature: Feature, legacy: () => boolean) {
  return decision ? decision.signals[feature] === "requested" : legacy();
}

/**
 * Which routing is on. Unset means Jev decides when a TypeSafe key is configured, and the built-in rules
 * otherwise. "0" forces the built-in rules, "shadow" runs Jev beside them, "1" forces Jev on.
 */
export function jevMode(env: Record<string, string | undefined> = process.env): "on" | "shadow" | "off" {
  const v = env.JEV_ROUTING;
  if (v === "0") return "off";
  if (v === "shadow") return "shadow";
  if (v === "1") return "on";
  return env.TYPESAFE_API_KEY ? "on" : "off";
}
