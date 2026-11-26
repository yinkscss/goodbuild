import { CARD_FILES } from "./cards";
import type { GameTemplate } from "./index";
import { appFor } from "./shared";

/**
 * Memory pairs (D143, PR 8 of D139): cards lie face down; turn two at a time to find the pairs, within a
 * limited number of tries. Its own game, not the match grid (which clears groups of tiles on a board).
 */

const INFO = `export const GAME_NAME = "Pair Up";
export const BEST_KEY = "pair-up";
`;

const GAME = `import { useRef, useState } from "react";
import { CardFace } from "../cards/CardFace";
import { shuffle, type Card } from "../cards/cards";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, moved, probe, round } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, GAME_NAME } from "./info";

// A puzzle with no rush: turn cards over by tapping them. Keep this in step with the game.
declareGame({ style: "puzzle", controls: ["buttons"] });

/** The pairs on the table: each card appears twice. */
const PAIRS: Card[] = ["AS", "KH", "QD", "JC", "10S", "9H"];
/** Tries (two cards each) before the round ends. */
const TRIES = 16;

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [table, setTable] = useState<Card[]>(() => shuffle([...PAIRS, ...PAIRS]));
  const [found, setFound] = useState<number[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const [tries, setTries] = useState(TRIES);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const scoreRef = useRef(0);
  const wait = useRef(0);
  const seen = useRef(new Set<number>());
  const board = useLeaderboard();

  const finish = (final: number) => {
    probe(final);
    round(false);
    if (saveBest(final, BEST_KEY)) setBest(final);
    sfx.win();
    setScreen("over");
  };

  const start = () => {
    window.clearTimeout(wait.current);
    scoreRef.current = 0;
    seen.current = new Set();
    setTable(shuffle([...PAIRS, ...PAIRS]));
    setFound([]);
    setOpen([]);
    setTries(TRIES);
    setScore(0);
    setScreen("playing");
    round(true);
    probe(0);
    sfx.tap();
  };

  const tap = (i: number) => {
    if (screen !== "playing" || open.length >= 2 || open.includes(i) || found.includes(i)) return;
    moved();
    sfx.tap();
    // 2 points for each card turned for the first time: finding out what's where is half the game.
    if (!seen.current.has(i)) {
      seen.current.add(i);
      scoreRef.current += 2;
      setScore(scoreRef.current);
      probe(scoreRef.current);
    }
    if (open.length === 0) return setOpen([i]);
    const [a] = open;
    const left = tries - 1;
    setTries(left);
    setOpen([a, i]);
    if (table[a] === table[i]) {
      const now = [...found, a, i];
      setFound(now);
      scoreRef.current += 20;
      setScore(scoreRef.current);
      probe(scoreRef.current);
      sfx.coin();
      buzz("collect");
      setOpen([]);
      if (now.length === table.length) {
        // Every pair found: 5 points for each try left.
        scoreRef.current += 5 * left;
        setScore(scoreRef.current);
        return finish(scoreRef.current);
      }
      if (left <= 0) return finish(scoreRef.current);
    } else {
      buzz("hit");
      // A moment to see both cards, then they turn back.
      wait.current = window.setTimeout(() => setOpen([]), 600);
    }
    if (left <= 0) wait.current = window.setTimeout(() => finish(scoreRef.current), 600);
  };

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
              tagline={"Find all " + PAIRS.length + " pairs in " + TRIES + " tries."}
              best={best}
              onPlay={start}
              howTo={["Tap two cards to turn them over.", "A match stays face up; anything else turns back.", "New cards and pairs score, and tries left at the end are a bonus."]}
              wallet
            />
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-3 pt-8">
            <div className="flex items-center justify-between pr-24 text-sm tabular-nums">
              <span>Tries left {tries}</span>
              <span>Pairs {found.length / 2}/{PAIRS.length}</span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{score}</p>
            <div data-game-area className="grid grid-cols-4 gap-2">
              {table.map((card, i) => {
                const up = open.includes(i) || found.includes(i);
                return (
                  <button key={i} type="button" disabled={found.includes(i)} aria-label={up ? "Card " + (i + 1) + ": " + card : "Card " + (i + 1) + ", face down"} onClick={() => tap(i)} className={"flex justify-center rounded-lg p-1 " + (found.includes(i) ? "opacity-50" : "")}>
                    <CardFace card={card} down={!up} size={64} />
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Pairs", value: found.length / 2 + "/" + PAIRS.length }]} onAgain={start} shareText={"I scored " + score + " in " + GAME_NAME}>
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

export const memoryPairs: GameTemplate = {
  id: "memory-pairs",
  name: "Memory pairs",
  dims: "2d",
  style: "puzzle",
  fits: "memory games: cards or tiles face down, turn two at a time to find matching pairs (pictures, words and their meanings, flags, cards)",
  kits: ["game-2d"],
  files: { ...CARD_FILES, "src/App.tsx": appFor("./play/info", "GAME_NAME"), "src/play/info.ts": INFO, "src/play/Game.tsx": GAME },
  leaderboard: true,
  title: { from: "./play/info", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Memory pairs template, a working, tested game: src/play/Game.tsx (the game), src/play/info.ts (its name), src/cards/ (the card face) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY), and change what is paired to the plan's topic (pictures, words, flags): replace PAIRS and draw each one in place of CardFace. Restyle it to the plan's look, and change the numbers the plan asks for (pairs, tries).
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every card turned, probe(score) when the score changes, the cards inside <div data-game-area>, GameOver on the game with PostScore, free play with no wallet.`,
};
