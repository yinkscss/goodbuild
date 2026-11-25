import { CARD_FILES } from "./cards";
import type { GameTemplate } from "./index";
import { appFor } from "./shared";

const INFO = `export const GAME_NAME = "High Card Run";
export const BEST_KEY = "high-card-run";
`;

/**
 * Higher or lower (D143, PR 8 of D139): one card shows; guess whether the next is higher or lower. A
 * right guess scores and builds a streak, a wrong one costs a life. For points only, never money (D4, D72).
 */

const GAME = `import { useRef, useState } from "react";
import { CardFace } from "../cards/CardFace";
import { fullDeck, shuffle, valueOf, type Card } from "../cards/cards";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { Leaderboard, PostScore } from "../game/Leaderboard";
import { TopThree } from "../game/TopThree";
import { buzz } from "../game/haptics";
import { useLeaderboard } from "../game/leaderboard";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, GAME_NAME } from "./info";

// A turn-based card game played with two buttons, with a skip power-up. Keep this in step with the game.
declareGame({ style: "turns", controls: ["buttons"], powerups: ["skip"] });

const LIVES = 3;
/** Right guesses in a row that double the points, and earn a skip. */
const STREAK = 4;

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [deck, setDeck] = useState<Card[]>(() => shuffle(fullDeck()));
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [streak, setStreak] = useState(0);
  const [skips, setSkips] = useState(1);
  const [last, setLast] = useState<"right" | "wrong" | "same" | null>(null);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const scoreRef = useRef(0);
  const board = useLeaderboard();

  const card = deck[at];
  const next = deck[at + 1];

  const finish = () => {
    probe(scoreRef.current);
    round(false);
    if (saveBest(scoreRef.current, BEST_KEY)) setBest(scoreRef.current);
    sfx.win();
    setScreen("over");
  };

  const start = () => {
    scoreRef.current = 0;
    setDeck(shuffle(fullDeck()));
    setAt(0);
    setScore(0);
    setLives(LIVES);
    setStreak(0);
    setSkips(1);
    setLast(null);
    setScreen("playing");
    round(true);
    probe(0);
    spawned("skip");
    sfx.tap();
  };

  /** Higher (true) or lower (false). A tie is neither: no points, no life lost. */
  const guess = (higher: boolean) => {
    if (screen !== "playing" || !next) return;
    moved();
    const a = valueOf(card);
    const b = valueOf(next);
    let left = lives;
    if (a === b) setLast("same");
    else if (b > a === higher) {
      const run = streak + 1;
      scoreRef.current += 10 * (run >= STREAK ? 2 : 1);
      setScore(scoreRef.current);
      setStreak(run);
      setLast("right");
      probe(scoreRef.current);
      sfx.coin();
      buzz("collect");
      if (run % STREAK === 0) {
        setSkips((s) => s + 1);
        spawned("skip");
      }
    } else {
      left = lives - 1;
      setLives(left);
      setStreak(0);
      setLast("wrong");
      sfx.hit();
      buzz("hit");
    }
    // The deck runs out after 51 guesses: that ends the round too.
    if (left <= 0 || at + 2 >= deck.length) return finish();
    setAt((n) => n + 1);
  };

  const skip = () => {
    if (skips <= 0 || !next || at + 2 >= deck.length) return;
    setSkips((s) => s - 1);
    setAt((n) => n + 1);
    setLast(null);
    sfx.tap();
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
              tagline="Will the next card be higher or lower?"
              best={best}
              onPlay={start}
              howTo={["Tap Higher or Lower for the next card. Ace is low, king is high.", "Four right in a row doubles the points and earns a skip.", "A wrong guess costs a life."]}
              powerUps={[
                  { name: "Skip", text: "move past a card you can't call. You start with one." },
              ]}
              wallet
            />
          </div>
        )}
        {screen !== "start" && (
          <div className="flex flex-col items-center gap-4 pt-8">
            <div className="flex w-full items-center justify-between pr-24 text-sm tabular-nums">
              <span>{"♥".repeat(Math.max(0, lives))}</span>
              <span>Card {at + 1}/{deck.length}</span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{score}</p>
            {streak >= STREAK && <p className="text-sm font-medium text-primary">Streak x2</p>}
            <CardFace card={card} size={112} />
            <p className="h-5 text-sm" aria-live="polite">{last === "right" ? "Right!" : last === "wrong" ? "Wrong" : last === "same" ? "Same value: no change" : ""}</p>
            <div data-game-area className="grid w-full grid-cols-2 gap-3">
              <button type="button" onClick={() => guess(true)} className="rounded-xl bg-primary px-4 py-4 text-lg font-semibold text-primary-foreground">
                Higher
              </button>
              <button type="button" onClick={() => guess(false)} className="rounded-xl bg-accent px-4 py-4 text-lg font-semibold text-accent-foreground">
                Lower
              </button>
            </div>
            <button type="button" onClick={skip} disabled={skips <= 0 || screen !== "playing"} className="text-sm underline disabled:opacity-40">
              Skip this card ({skips})
            </button>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Cards", value: at + 1 }]} onAgain={start} shareText={"I scored " + score + " in " + GAME_NAME}>
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

export const higherLower: GameTemplate = {
  id: "higher-lower",
  name: "Higher or lower",
  dims: "2d",
  style: "turns",
  fits: "guess-the-next-card games: higher or lower, over or under, with a deck of playing cards or any numbered cards, for points only",
  kits: ["game-2d"],
  files: { ...CARD_FILES, "src/App.tsx": appFor("./play/info", "GAME_NAME"), "src/play/info.ts": INFO, "src/play/Game.tsx": GAME },
  leaderboard: true,
  title: { from: "./play/info", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Higher or lower template, a working, tested card game: src/play/Game.tsx (the game), src/play/info.ts (its name), src/cards/ (the deck and the card face) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY), restyle the cards in src/cards/CardFace.tsx and the screen to the plan's look, and change the rules the plan asks for (lives, the streak, skips).
- Points only: never bets, stakes, entry fees or prizes in money or tokens (GoodBuild doesn't build gambling).
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every guess, probe(score) when the score changes, the two guess buttons inside <div data-game-area>, GameOver on the game with PostScore, free play with no wallet.`,
};
