import { SCORES_RULE_JSON } from "../kits/game-2d";
import { kitById, withKit } from "../kits/index";

import { laneRacer } from "./lane-racer";
import { quickQuiz } from "./quick-quiz";

/**
 * Game templates (D114): working, tested games the builder reshapes to the plan, instead of writing a
 * game from an empty screen. The planner picks one in the game brief; on the first build the runner
 * adds its files. Unlike a kit's files they belong to the person from then on: never put back, never
 * replaced by a newer version. Every template is original to GoodBuild and named for how it plays.
 */
export interface GameTemplate {
  /** Lowercase, hyphenated: what the planner names in the brief. */
  id: string;
  /** For people, on the plan card: "Lane racer". */
  name: string;
  dims: "2d" | "3d";
  style: "action" | "puzzle" | "turns";
  /** What requests it fits, for the planner's catalogue. */
  fits: string;
  /** Kits it needs on. */
  kits: string[];
  /** Its files, written over the starter's on the first build. */
  files: Record<string, string>;
  /** It has the kit's leaderboard, so it needs the scores rule in dataRules.json. */
  leaderboard?: boolean;
  /** What the builder is told about it. */
  brief: string;
}

export const GAME_TEMPLATES: GameTemplate[] = [laneRacer, quickQuiz];

export function gameTemplateById(id: string | undefined | null): GameTemplate | undefined {
  return id ? GAME_TEMPLATES.find((t) => t.id === id) : undefined;
}

/** One line per template, for the planner. */
export function gameTemplateCatalog(): string {
  return GAME_TEMPLATES.map((t) => `- ${t.id} (${t.dims.toUpperCase()}, ${t.style}): ${t.fits}`).join("\n");
}

/**
 * The project with a template's kits on, its files written, and the leaderboard's rule added. For the
 * first build only: it writes over src/App.tsx.
 */
export function withGameTemplate(files: Record<string, string>, template: GameTemplate): Record<string, string> {
  let out = { ...files };
  for (const id of template.kits) {
    const kit = kitById(id);
    if (kit) out = withKit(out, kit);
  }
  Object.assign(out, template.files);
  if (template.leaderboard) {
    let rules: { collections?: Record<string, unknown> } & Record<string, unknown> = {};
    try {
      rules = JSON.parse(out["src/lib/dataRules.json"] ?? "{}") as typeof rules;
    } catch {
      rules = {};
    }
    const scores = (JSON.parse("{" + SCORES_RULE_JSON + "}") as { scores: unknown }).scores;
    if (!rules.collections?.scores) out["src/lib/dataRules.json"] = JSON.stringify({ ...rules, collections: { ...(rules.collections ?? {}), scores } }, null, 2) + "\n";
  }
  return out;
}
