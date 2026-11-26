import type { GameTemplate } from "./index";

/**
 * Quick quiz (D114): timed questions with three lives, a streak multiplier, a hint power-up, today's
 * set in the same order for everyone, and the leaderboard on the game. No canvas: a "turns" game played
 * with answer buttons, which reports its own rounds to GoodBuild's check (D112).
 */

const QUESTIONS = `// The questions. Replace them with ones about the plan's topic: 10 or more, four answers each,
// one right (its index in answers). Keep them short enough to read on a phone in a few seconds.

export const QUIZ_NAME = "Quick Quiz";
export const BEST_KEY = "quick-quiz";
/** Seconds to answer each question. */
export const SECONDS = 12;

export interface Question {
  q: string;
  answers: string[];
  right: number;
}

export const QUESTIONS: Question[] = [
  { q: "Which planet is known as the red planet?", answers: ["Venus", "Mars", "Jupiter", "Mercury"], right: 1 },
  { q: "How many legs does a spider have?", answers: ["6", "8", "10", "12"], right: 1 },
  { q: "What is 7 x 8?", answers: ["54", "56", "58", "64"], right: 1 },
  { q: "Which is the largest ocean?", answers: ["Atlantic", "Indian", "Pacific", "Arctic"], right: 2 },
  { q: "What do bees make?", answers: ["Milk", "Silk", "Honey", "Wax only"], right: 2 },
  { q: "Which gas do plants take in?", answers: ["Oxygen", "Carbon dioxide", "Helium", "Nitrogen"], right: 1 },
  { q: "How many days are in a leap year?", answers: ["364", "365", "366", "367"], right: 2 },
  { q: "Which is the longest river in Africa?", answers: ["Niger", "Congo", "Zambezi", "Nile"], right: 3 },
  { q: "What is the boiling point of water at sea level?", answers: ["90 C", "100 C", "110 C", "120 C"], right: 1 },
  { q: "Which shape has three sides?", answers: ["Square", "Triangle", "Circle", "Hexagon"], right: 1 },
  { q: "What is half of 150?", answers: ["65", "70", "75", "80"], right: 2 },
  { q: "Which animal is known as the king of the jungle?", answers: ["Elephant", "Lion", "Tiger", "Gorilla"], right: 1 },
];
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
import { BEST_KEY, QUESTIONS, QUIZ_NAME, SECONDS, type Question } from "./questions";

// A turn-based game played with answer buttons, with a hint power-up. Keep this in step with what the game has.
declareGame({ style: "turns", controls: ["buttons"], powerups: ["hint"] });

const LIVES = 3;
/** Right answers in a row that double the points. */
const STREAK = 3;

type Screen = "start" | "playing" | "over";

/** Today's set: the same questions in the same order for everyone, all day. */
function todaysSet(): Question[] {
  const rand = seededRandom(dailySeed());
  const order = QUESTIONS.map((q) => ({ q, k: rand() }));
  return order.sort((a, b) => a.k - b.k).map((o) => o.q);
}

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [set, setSet] = useState<Question[]>(() => todaysSet());
  const [at, setAt] = useState(0);
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(LIVES);
  const [streak, setStreak] = useState(0);
  const [hints, setHints] = useState(1);
  const [hidden, setHidden] = useState<number[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const board = useLeaderboard();
  const scoreRef = useRef(0);
  // The clock for each question lives in a ref and draws its bar straight to the page: no re-render every frame.
  const leftRef = useRef(SECONDS);
  const bar = useRef<HTMLDivElement>(null);

  const question = set[at % set.length];
  const finished = at >= set.length;

  const finish = (final: number) => {
    probe(final);
    round(false);
    if (saveBest(final, BEST_KEY)) setBest(final);
    sfx.win();
    setScreen("over");
  };

  const next = (nextLives: number, nextScore: number) => {
    window.setTimeout(() => {
      setPicked(null);
      setHidden([]);
      leftRef.current = SECONDS;
      if (nextLives <= 0 || at + 1 >= set.length) finish(nextScore);
      else setAt((n) => n + 1);
    }, 450);
  };

  /** i is the answer picked, or -1 when the clock ran out (not a move the player made). */
  const answer = (i: number) => {
    if (screen !== "playing" || picked !== null || hidden.includes(i)) return;
    if (i >= 0) moved();
    setPicked(i);
    if (i === question.right) {
      const run = streak + 1;
      const points = (10 + Math.ceil(leftRef.current)) * (run >= STREAK ? 2 : 1);
      scoreRef.current += points;
      setScore(scoreRef.current);
      setStreak(run);
      probe(scoreRef.current);
      sfx.coin();
      buzz("collect");
      // Every few right answers in a row earns another hint.
      if (run % STREAK === 0) {
        setHints((h) => h + 1);
        spawned("hint");
      }
      next(lives, scoreRef.current);
    } else {
      setLives(lives - 1);
      setStreak(0);
      sfx.hit();
      buzz("hit");
      next(lives - 1, scoreRef.current);
    }
  };

  // The clock for each question. Running out counts as a wrong answer.
  const timeout = useRef(answer);
  timeout.current = answer;
  useEffect(() => {
    if (screen !== "playing" || picked !== null) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      leftRef.current = Math.max(0, leftRef.current - (now - last) / 1000);
      last = now;
      if (bar.current) bar.current.style.width = (leftRef.current / SECONDS) * 100 + "%";
      if (leftRef.current === 0) {
        timeout.current(-1);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [screen, picked, at]);

  const takeHint = () => {
    // One hint per question: a second would hide the same two answers again.
    if (hints <= 0 || picked !== null || hidden.length > 0) return;
    // Take away two wrong answers.
    const wrong = question.answers.map((_, i) => i).filter((i) => i !== question.right);
    setHidden(wrong.slice(0, 2));
    setHints((h) => h - 1);
    sfx.tap();
  };

  const start = () => {
    scoreRef.current = 0;
    setSet(todaysSet());
    setAt(0);
    setScore(0);
    setLives(LIVES);
    setStreak(0);
    setHints(1);
    setHidden([]);
    setPicked(null);
    leftRef.current = SECONDS;
    setScreen("playing");
    round(true);
    probe(0);
    spawned("hint");
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
              title={QUIZ_NAME}
              tagline={"Today's " + set.length + " questions. Answer fast for more points."}
              best={best}
              onPlay={start}
              howTo={["Tap the answer you think is right before the bar runs out.", "Faster answers score more; three right in a row doubles your points.", "A wrong answer or running out of time costs a life. Three lives, then it's over."]}
              powerUps={[{ name: "Hint", text: "takes away two wrong answers. You start with one and earn more with a streak." }]}
              wallet
            />
          </div>
        )}
        {screen === "playing" && !finished && (
          <div className="space-y-4">
            <div className="flex items-center justify-between pr-24 text-sm tabular-nums">
              <span>Question {at + 1}/{set.length}</span>
              <span>{"♥".repeat(Math.max(0, lives))}</span>
            </div>
            <p className="text-3xl font-semibold tabular-nums">{score}</p>
            {streak >= STREAK && <p className="text-sm font-medium text-primary">Streak x2</p>}
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div ref={bar} className="h-full bg-primary" style={{ width: "100%" }} />
            </div>
            <p className="text-lg font-medium">{question.q}</p>
            <div data-game-area className="grid gap-2">
              {question.answers.map((a, i) => {
                const state = picked === null ? "" : i === question.right ? "bg-success text-white" : i === picked ? "bg-danger text-white" : "opacity-60";
                return (
                  <button
                    key={a}
                    type="button"
                    disabled={hidden.includes(i)}
                    onClick={() => answer(i)}
                    className={"rounded-xl border bg-background px-4 py-3 text-left text-base font-medium disabled:invisible " + state}
                  >
                    {a}
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={takeHint} disabled={hints <= 0 || picked !== null || hidden.length > 0} className="text-sm underline disabled:opacity-40">
              Use a hint ({hints})
            </button>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Answered", value: Math.min(at + 1, set.length) + "/" + set.length }]} onAgain={start} shareText={"I scored " + score + " in " + QUIZ_NAME}>
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

const APP = `import Game from "./play/Game";
import { QUIZ_NAME } from "./play/questions";

export default function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{QUIZ_NAME}</h1>
      </header>
      <Game />
    </main>
  );
}
`;

export const quickQuiz: GameTemplate = {
  id: "quick-quiz",
  name: "Quick quiz",
  dims: "2d",
  style: "turns",
  fits: "quizzes and trivia on any topic, true or false, guess the answer, school or exam practice, fan quizzes",
  kits: ["game-2d"],
  files: { "src/App.tsx": APP, "src/play/Game.tsx": GAME, "src/play/questions.ts": QUESTIONS },
  leaderboard: true,
  title: { from: "./play/questions", name: "QUIZ_NAME" },
  brief: `This game starts from GoodBuild's Quick quiz template, a working, tested game: src/play/Game.tsx (the quiz), src/play/questions.ts (the name and the questions) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (QUIZ_NAME, BEST_KEY) and write the questions about the plan's topic in questions.ts: at least 10, four short answers each, facts you are sure of.
- Restyle it to the plan's look. Change the rules the plan asks for (seconds per question, lives, streaks, hints), and keep declareGame listing the power-ups the game has.
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every answer, probe(score) when the score changes, the answers inside <div data-game-area>, GameOver on the quiz with PostScore, free play with no wallet.`,
};
