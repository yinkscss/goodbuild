import type { GameTemplate } from "./index";
import { appFor } from "./shared";

/**
 * Match grid (D117): a puzzle on a grid of coloured tiles. Tap a group of two or more touching tiles
 * of one colour to clear it; the tiles above fall and new ones drop in. Big groups score far more and
 * leave a bomb that clears the tiles round it; stones block the grid until a group next to them is
 * cleared. Twenty moves on today's board, the same for everyone, and the leaderboard on the game.
 * No canvas: a grid of buttons that reports its own rounds and moves to GoodBuild's check (D112).
 * Original to GoodBuild: named for how it plays.
 */

const TILES = `// The tiles and the rules. Change the colours, names and numbers to fit the plan.

export const GAME_NAME = "Match Grid";
export const BEST_KEY = "match-grid";

export const COLS = 7;
export const ROWS = 8;
/** Moves in a round. */
export const MOVES = 20;
/** A group this big or bigger leaves a bomb where it was tapped. */
export const BOMB_GROUP = 5;
/** Stones on a fresh board. */
export const STONES = 4;

/** The tile colours, each with a name for screen readers. Four is a good number: fewer is easy, more is hard. */
export const COLOURS = [
  { name: "Red", fill: "#f43f5e" },
  { name: "Blue", fill: "#3b82f6" },
  { name: "Green", fill: "#22c55e" },
  { name: "Yellow", fill: "#facc15" },
];
export const STONE = { name: "Stone", fill: "#78716c" };
export const BOMB = { name: "Bomb", fill: "#0f172a" };

/** Points for clearing a group of n tiles: bigger groups are worth far more. */
export function pointsFor(n: number): number {
  return n * (n - 1) * 5;
}
`;

const GAME = `import { useEffect, useRef, useState } from "react";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { dailySeed, seededRandom } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, BOMB, BOMB_GROUP, COLOURS, COLS, GAME_NAME, MOVES, ROWS, STONE, STONES, pointsFor } from "./tiles";

// A puzzle played by tapping tiles, with stones in the way and bombs to earn. Keep this in step with what the game has.
declareGame({ style: "puzzle", controls: ["buttons"], obstacles: ["stone"], powerups: ["bomb"] });

/** A cell: a colour (an index into COLOURS), a stone, or a bomb. */
type Cell = { kind: "tile"; colour: number } | { kind: "stone" } | { kind: "bomb" };
type Grid = Cell[];
type Screen = "start" | "playing" | "over";

const at = (col: number, row: number) => row * COLS + col;
const neighbours = (i: number) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const out: number[] = [];
  if (col > 0) out.push(i - 1);
  if (col < COLS - 1) out.push(i + 1);
  if (row > 0) out.push(i - COLS);
  if (row < ROWS - 1) out.push(i + COLS);
  return out;
};

/** Every tile touching i with the same colour, i included. */
function groupOf(grid: Grid, i: number): number[] {
  const first = grid[i];
  if (first.kind !== "tile") return [];
  const seen = new Set([i]);
  const todo = [i];
  while (todo.length) {
    const n = todo.pop()!;
    for (const m of neighbours(n)) {
      const c = grid[m];
      if (!seen.has(m) && c.kind === "tile" && c.colour === first.colour) {
        seen.add(m);
        todo.push(m);
      }
    }
  }
  return [...seen];
}

/** Whether any move is left: a group of two or a bomb. */
function canMove(grid: Grid): boolean {
  return grid.some((c, i) => c.kind === "bomb" || (c.kind === "tile" && neighbours(i).some((m) => { const d = grid[m]; return d.kind === "tile" && d.colour === c.colour; })));
}

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [grid, setGrid] = useState<Grid>([]);
  const [score, setScore] = useState(0);
  const [movesLeft, setMovesLeft] = useState(MOVES);
  const [cleared, setCleared] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const board = useLeaderboard();
  const rand = useRef(seededRandom(dailySeed()));
  const scoreRef = useRef(0);
  const movesRef = useRef(MOVES);

  const randomTile = (): Cell => ({ kind: "tile", colour: Math.floor(rand.current() * COLOURS.length) });

  /** Today's board: the same tiles, stones and bomb for everyone, all day. */
  const freshGrid = (): Grid => {
    rand.current = seededRandom(dailySeed());
    const g: Grid = Array.from({ length: COLS * ROWS }, randomTile);
    for (let s = 0; s < STONES; s++) g[at(1 + Math.floor(rand.current() * (COLS - 2)), 3 + Math.floor(rand.current() * (ROWS - 4)))] = { kind: "stone" };
    g[at(Math.floor(COLS / 2), ROWS - 1)] = { kind: "bomb" };
    return g;
  };

  /** Clear the cells, crack stones next to them, let the rest fall and fill the gaps from the top. */
  const settle = (g: Grid, gone: Set<number>): { grid: Grid; stones: number } => {
    let stones = 0;
    for (const i of [...gone]) {
      for (const m of neighbours(i)) {
        if (g[m].kind === "stone" && !gone.has(m)) {
          gone.add(m);
          stones++;
        }
      }
    }
    const next = g.slice();
    for (let col = 0; col < COLS; col++) {
      const kept: Cell[] = [];
      for (let row = ROWS - 1; row >= 0; row--) if (!gone.has(at(col, row))) kept.push(g[at(col, row)]);
      for (let row = ROWS - 1, k = 0; row >= 0; row--, k++) next[at(col, row)] = k < kept.length ? kept[k] : randomTile();
    }
    return { grid: next, stones };
  };

  const finish = () => {
    const final = scoreRef.current;
    probe(final);
    round(false);
    if (saveBest(final, BEST_KEY)) setBest(final);
    sfx.win();
    setScreen("over");
  };

  const tap = (i: number) => {
    if (screen !== "playing") return;
    const cell = grid[i];
    let gone: number[] = [];
    if (cell.kind === "bomb") {
      // A bomb clears the three by three square round it, stones too.
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) {
        const c = col + dc;
        const r = row + dr;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) gone.push(at(c, r));
      }
    } else if (cell.kind === "tile") {
      gone = groupOf(grid, i);
      if (gone.length < 2) {
        sfx.tap();
        return;
      }
    } else return;

    moved();
    const points = pointsFor(gone.length);
    const removed = new Set(gone);
    // A big group leaves a bomb where it was tapped.
    const earned = cell.kind === "tile" && gone.length >= BOMB_GROUP;
    if (earned) removed.delete(i);
    const before = grid.slice();
    if (earned) before[i] = { kind: "bomb" };
    const { grid: next, stones } = settle(before, removed);
    scoreRef.current += points + stones * 15;
    setScore(scoreRef.current);
    setCleared((n) => n + removed.size);
    probe(scoreRef.current);
    if (earned) spawned("bomb");
    if (cell.kind === "bomb" || stones) buzz("hit");
    else buzz("collect");
    sfx.coin();

    // No move left on the board: shuffle the colours, free.
    setGrid(canMove(next) ? next : next.map((c) => (c.kind === "tile" ? randomTile() : c)));
    movesRef.current -= 1;
    setMovesLeft(movesRef.current);
    if (movesRef.current <= 0) finish();
  };

  const start = () => {
    scoreRef.current = 0;
    movesRef.current = MOVES;
    setGrid(freshGrid());
    setScore(0);
    setMovesLeft(MOVES);
    setCleared(0);
    setScreen("playing");
    round(true);
    probe(0);
    spawned("stone");
    spawned("bomb");
    sfx.tap();
  };

  // Leaving the page mid-round ends the round for the check.
  useEffect(() => () => round(false), []);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        <TopThree board={board} className="absolute right-3 top-3" />
        {screen === "start" && (
          <div className="flex min-h-[420px] items-center">
            <GameMenu
              card={false}
              className="w-full"
              title={GAME_NAME}
              tagline={"Clear groups of tiles. " + MOVES + " moves on today's board."}
              best={best}
              onPlay={start}
              howTo={["Tap two or more touching tiles of one colour to clear them.", "Bigger groups score far more. Tiles above fall into the gaps.", "Stones break when you clear tiles next to them. You have " + MOVES + " moves."]}
              powerUps={[
                  { name: "Bomb", text: "clear a big group at once to earn one; tap it to clear the tiles round it" },
              ]}
              wallet
            />
          </div>
        )}
        {screen === "playing" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pr-24 text-sm tabular-nums">
              <span>Moves {movesLeft}</span>
              <span>Cleared {cleared}</span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{score}</p>
            <div data-game-area className="grid gap-1" style={{ gridTemplateColumns: \`repeat(\${COLS}, minmax(0, 1fr))\` }}>
              {grid.map((cell, i) => {
                const look = cell.kind === "tile" ? COLOURS[cell.colour] : cell.kind === "stone" ? STONE : BOMB;
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={look.name + (cell.kind === "tile" ? " tile" : "")}
                    disabled={cell.kind === "stone"}
                    onClick={() => tap(i)}
                    className="aspect-square rounded-lg transition-transform duration-150 active:scale-90"
                    style={{ background: look.fill }}
                  >
                    {cell.kind === "bomb" && <span className="text-lg text-white">✸</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Tiles cleared", value: cleared }]} onAgain={start} shareText={"I scored " + score + " in " + GAME_NAME}>
            <PostScore board={board} score={score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top players" />
    </div>
  );
}
`;

export const matchGrid: GameTemplate = {
  id: "match-grid",
  name: "Match grid",
  dims: "2d",
  style: "puzzle",
  fits: "matching puzzles on a grid of tiles, gems, sweets or pictures: clear groups of the same colour or kind, with a limited number of moves and no rush",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/tiles", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/tiles.ts": TILES },
  leaderboard: true,
  title: { from: "./play/tiles", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Match grid template, a working, tested puzzle: src/play/Game.tsx (the grid and its rules), src/play/tiles.ts (the name, the tile colours and the numbers) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY in tiles.ts) and restyle the tiles to the plan's look (colours, names, a picture or emoji in each tile).
- Change the rules the plan asks for (grid size, moves, colours, what stones and bombs do), and keep declareGame listing the obstacles and power-ups the game has, with spawned(kind) when one appears.
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every move the grid accepts, probe(score) when the score changes, the tiles as buttons inside <div data-game-area>, GameOver with PostScore, free play with no wallet.`,
};
