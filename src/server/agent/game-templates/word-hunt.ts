import type { GameTemplate } from "./index";
import { appFor } from "./shared";

/**
 * Word hunt (D150, genre templates): today's grid of letters hides a set of words reading across or down.
 * Tap the letters that belong to a word; finish a word for a bonus; a wrong letter costs one of three
 * lives; a hint lights one letter. A "puzzle" game played with letter buttons (D112). Original to GoodBuild.
 */

const WORDS = `// The words and the grid's size. Replace WORDS with ones about the plan's topic: 8 or more, 3 to 7
// letters, capital letters only. Each round hides WORDS_PER_ROUND of them.

export const GAME_NAME = "Word Hunt";
export const BEST_KEY = "word-hunt";
export const COLS = 6;
export const ROWS = 7;
export const LIVES = 3;
export const WORDS_PER_ROUND = 5;

export const WORDS = ["RIVER", "STAR", "MANGO", "CLOUD", "TIGER", "PLANET", "OCEAN", "BREAD", "MUSIC", "GARDEN", "LAMP", "STONE"];

export interface Placed {
  word: string;
  cells: number[];
}

/**
 * Today's puzzle from a random number source: the hidden words, where each sits (across or down, letters
 * shared only where they match), and every cell's letter. Words that don't fit are left out.
 */
export function makePuzzle(rand: () => number): { letters: string[]; placed: Placed[] } {
  const letters: string[] = Array.from({ length: COLS * ROWS }, () => "");
  const pool = [...WORDS].sort(() => rand() - 0.5);
  const placed: Placed[] = [];
  for (const word of pool) {
    if (placed.length >= WORDS_PER_ROUND) break;
    for (let attempt = 0; attempt < 120; attempt++) {
      const across = rand() < 0.5;
      const maxCol = across ? COLS - word.length : COLS - 1;
      const maxRow = across ? ROWS - 1 : ROWS - word.length;
      if (maxCol < 0 || maxRow < 0) break;
      const col = Math.floor(rand() * (maxCol + 1));
      const row = Math.floor(rand() * (maxRow + 1));
      const cells = Array.from(word, (_, k) => (across ? row * COLS + col + k : (row + k) * COLS + col));
      if (cells.every((c, k) => letters[c] === "" || letters[c] === word[k])) {
        cells.forEach((c, k) => (letters[c] = word[k]));
        placed.push({ word, cells });
        break;
      }
    }
  }
  const abc = "ABCDEFGHIJKLMNOPRSTUW";
  for (let i = 0; i < letters.length; i++) if (!letters[i]) letters[i] = abc[Math.floor(rand() * abc.length)];
  return { letters, placed };
}
`;

const GAME = `import { useEffect, useRef, useState } from "react";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { dailySeed, firstTime, seededRandom } from "../game/extras";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, COLS, GAME_NAME, LIVES, makePuzzle, type Placed } from "./words";

// A puzzle played by tapping letters, with a hint power-up. Keep this in step with what the game has.
declareGame({ style: "puzzle", controls: ["buttons"], powerups: ["hint"] });

/** Points for each right letter, and for finishing a word (times the words finished in a row). */
const LETTER_POINTS = 5;
const WORD_POINTS = 20;

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [letters, setLetters] = useState<string[]>([]);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const [found, setFound] = useState<Set<number>>(new Set());
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [lives, setLives] = useState(LIVES);
  const [hints, setHints] = useState(1);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [tip] = useState(() => firstTime("word-hunt-tip"));
  const board = useLeaderboard();
  const scoreRef = useRef(0);
  const streak = useRef(0);

  const done = (p: Placed, have: Set<number>) => p.cells.every((c) => have.has(c));
  const wordsDone = placed.filter((p) => done(p, found)).length;

  const finish = (final: number) => {
    probe(final);
    round(false);
    if (saveBest(final, BEST_KEY)) setBest(final);
    sfx.win();
    setScreen("over");
  };

  const add = (points: number) => {
    scoreRef.current += points;
    setScore(scoreRef.current);
    probe(scoreRef.current);
  };

  /** A letter found, by a tap or a hint: points, and a word's bonus when it completes one. */
  const reveal = (i: number, have: Set<number>) => {
    const next = new Set(have);
    next.add(i);
    let points = LETTER_POINTS;
    for (const p of placed) {
      if (p.cells.includes(i) && !done(p, have) && done(p, next)) {
        streak.current += 1;
        points += WORD_POINTS * streak.current;
        // Every second word earns another hint.
        if (streak.current % 2 === 0) {
          setHints((h) => h + 1);
          spawned("hint");
        }
        sfx.win();
        buzz("collect");
      }
    }
    add(points);
    setFound(next);
    if (placed.every((p) => done(p, next))) window.setTimeout(() => finish(scoreRef.current + lives * 25), 400);
  };

  const tap = (i: number) => {
    if (screen !== "playing" || found.has(i) || wrong.has(i)) return;
    moved();
    if (placed.some((p) => p.cells.includes(i))) {
      sfx.coin();
      reveal(i, found);
      return;
    }
    // Not part of any word: a life gone, and the streak with it.
    const left = lives - 1;
    setWrong(new Set(wrong).add(i));
    setLives(left);
    streak.current = 0;
    sfx.hit();
    buzz("hit");
    if (left <= 0) window.setTimeout(() => finish(scoreRef.current), 400);
  };

  const takeHint = () => {
    if (hints <= 0 || screen !== "playing") return;
    const missing = placed.flatMap((p) => p.cells).find((c) => !found.has(c));
    if (missing === undefined) return;
    setHints((h) => h - 1);
    sfx.tap();
    reveal(missing, found);
  };

  const start = () => {
    const puzzle = makePuzzle(seededRandom(dailySeed()));
    scoreRef.current = 0;
    streak.current = 0;
    setLetters(puzzle.letters);
    setPlaced(puzzle.placed);
    setFound(new Set());
    setWrong(new Set());
    setLives(LIVES);
    setHints(1);
    setScore(0);
    setScreen("playing");
    round(true);
    probe(0);
    spawned("hint");
    sfx.tap();
  };

  // Leaving the page mid-round ends the round for the check.
  useEffect(() => () => round(false), []);

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        <TopThree board={board} className="absolute right-3 top-3" />
        {screen === "start" && (
          <div className="flex min-h-[420px] flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-2xl font-semibold">{GAME_NAME}</h2>
            <p className="text-muted-foreground">Words hide in today's grid, reading across or down. Tap their letters. A wrong letter costs a life.</p>
            {tip && <p className="text-sm">The list shows how long each word is. Stuck? A hint lights one letter.</p>}
            {best > 0 && <p className="text-sm">Your best: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Play
            </button>
          </div>
        )}
        {screen === "playing" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between pr-24 text-sm tabular-nums">
              <span>{"♥".repeat(Math.max(0, lives))}</span>
              <span>
                Words {wordsDone}/{placed.length}
              </span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{score}</p>
            <ul className="flex flex-wrap gap-2 text-sm" aria-label="Hidden words">
              {placed.map((p) => (
                <li key={p.word} className={"rounded-full px-3 py-1 font-mono " + (done(p, found) ? "bg-success text-white" : "bg-muted")}>
                  {done(p, found) ? p.word : Array.from(p.word, (_, k) => (found.has(p.cells[k]) ? p.word[k] : "_")).join(" ")}
                </li>
              ))}
            </ul>
            <div data-game-area className="grid gap-1" style={{ gridTemplateColumns: "repeat(" + COLS + ", minmax(0, 1fr))" }}>
              {letters.map((letter, i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={"Letter " + letter}
                  onClick={() => tap(i)}
                  className={
                    "aspect-square rounded-lg text-xl font-bold transition-transform duration-150 active:scale-90 " +
                    (found.has(i) ? "bg-primary text-primary-foreground" : wrong.has(i) ? "bg-danger/20 text-danger line-through" : "bg-muted")
                  }
                >
                  {letter}
                </button>
              ))}
            </div>
            <button type="button" onClick={takeHint} disabled={hints <= 0} className="text-sm underline disabled:opacity-40">
              Use a hint ({hints})
            </button>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Words found", value: wordsDone + "/" + placed.length }]} onAgain={start} shareText={"I scored " + score + " in " + GAME_NAME}>
            <PostScore board={board} score={score} />
          </GameOver>
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
      <Leaderboard board={board} title="Top word hunters" />
    </div>
  );
}
`;

export const wordHunt: GameTemplate = {
  id: "word-hunt",
  name: "Word hunt",
  dims: "2d",
  style: "puzzle",
  fits: "word games on a grid of letters: word searches, finding hidden words, spelling and vocabulary practice, letters on any theme, no rush",
  kits: ["game-2d"],
  files: { "src/App.tsx": appFor("./play/words", "GAME_NAME"), "src/play/Game.tsx": GAME, "src/play/words.ts": WORDS },
  leaderboard: true,
  title: { from: "./play/words", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Word hunt template, a working, tested game: src/play/words.ts (the name, the words, the grid's size and makePuzzle), src/play/Game.tsx (the game) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY) and write WORDS about the plan's topic: 8 or more, 3 to 7 capital letters each, real words spelled right. Restyle it to the plan's look.
- Change the rules the plan asks for (lives, words per round, grid size, hints, points) and keep declareGame listing the power-ups the game has.
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every tap, probe(score) when the score changes, the letters inside <div data-game-area>, today's grid from dailySeed() so everyone gets the same puzzle, GameOver with PostScore, free play with no wallet.`,
};
