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
  /** Where the game's name comes from, for the app around it: the import line and the name to show. */
  title: { from: string; name: string };
  /** What the builder is told about it. */
  brief: string;
}

export const GAME_TEMPLATES: GameTemplate[] = [laneRacer, quickQuiz];

/** The app around a template's game inside MiniPay: the game on the home route, the five info pages, the footer. */
function miniPayApp(template: GameTemplate): string {
  return `import { HashRouter, Outlet, Route, Routes } from "react-router-dom";
import { INFO_ROUTES, InfoPage } from "./minipay/InfoPages";
import { MiniFooter } from "./minipay/MiniFooter";
import Game from "./play/Game";
import { ${template.title.name} } from "${template.title.from}";

function Layout() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{${template.title.name}}</h1>
      </header>
      <Outlet />
      <MiniFooter />
    </main>
  );
}

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Game />} />
          {INFO_ROUTES.map((r) => (
            <Route key={r.path} path={r.path} element={<InfoPage kind={r.kind} />} />
          ))}
        </Route>
      </Routes>
    </HashRouter>
  );
}
`;
}

/** Said to the builder with every template. */
export const TEMPLATE_MINIPAY_NOTE =
  "If the MiniPay kit is on, the info pages, the footer and (with the leaderboard contract) posting from MiniPay are already wired in src/App.tsx and src/play/Game.tsx: fill in MINI_APP in src/minipay/app.ts with the game's name, a one-line tagline and three how-to steps.";

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
  // In MiniPay (D88) the app around the game needs the info pages and the footer, and posting goes to the
  // board contract when its kit is on (D93). Written here so the first build doesn't spend fixes on them.
  if (out["src/minipay/MiniFooter.tsx"] !== undefined) out["src/App.tsx"] = miniPayApp(template);
  const game = out["src/play/Game.tsx"];
  if (out["contracts/GameBoard.sol"] !== undefined && game?.includes("const board = useLeaderboard();")) {
    out["src/play/Game.tsx"] = game
      .replace(
        'import { useLeaderboard } from "../game/leaderboard";',
        'import { GameBoardAbi, GameBoardAddress } from "../contracts";\nimport { gameBoard } from "../game/chainBoard";\nimport { useLeaderboard } from "../game/leaderboard";\nimport { chain } from "../lib/chain";',
      )
      .replace("const board = useLeaderboard();", "const board = useLeaderboard({ chain: miniPayBoard });")
      .replace("\nexport default function Game()", "\n// Inside MiniPay scores go to the leaderboard contract: MiniPay allows no sign-in signature.\nconst miniPayBoard = gameBoard(GameBoardAbi, GameBoardAddress[chain.id]);\n\nexport default function Game()");
  }
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
