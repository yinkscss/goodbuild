import type { GameTemplate } from "./index";
import { ROOM_BRIEF, ROOM_FILES, ROOM_RULES } from "./room";
import { appFor } from "./shared";

/**
 * Trivia battle (D139, PR 5): 2 to 8 players answer the same questions in the same order, each at their
 * own pace against the clock, with everyone's score live in the room. Or against three computer players,
 * which is what the run check plays. Original name and questions.
 */

const QUESTIONS = `// The questions. Replace them with ones about the plan's topic: 12 or more, four answers each, one
// right (its index in answers). Keep them short enough to read on a phone in a few seconds.

export const GAME_NAME = "Answer Rush";
export const BEST_KEY = "answer-rush";
/** Seconds to answer each question. */
export const SECONDS = 15;
/** Questions in one round: everyone gets the same ones, in the same order. */
export const ROUND_SIZE = 10;
/** The computer players in a practice round. */
export const BOTS = [
  { name: "Kemi", skill: 0.7 },
  { name: "Tobi", skill: 0.55 },
  { name: "Zara", skill: 0.4 },
];

export interface Question {
  q: string;
  answers: string[];
  right: number;
}

export const QUESTIONS: Question[] = [
  { q: "Which planet is closest to the sun?", answers: ["Venus", "Mercury", "Mars", "Earth"], right: 1 },
  { q: "How many minutes are in two hours?", answers: ["100", "120", "140", "160"], right: 1 },
  { q: "Which is the largest desert in Africa?", answers: ["Kalahari", "Namib", "Sahara", "Danakil"], right: 2 },
  { q: "What colour do you get mixing blue and yellow?", answers: ["Green", "Purple", "Orange", "Brown"], right: 0 },
  { q: "How many sides does a hexagon have?", answers: ["5", "6", "7", "8"], right: 1 },
  { q: "Which organ pumps blood around the body?", answers: ["Lungs", "Liver", "Heart", "Kidney"], right: 2 },
  { q: "What is 9 x 6?", answers: ["54", "56", "48", "63"], right: 0 },
  { q: "Which animal is the tallest?", answers: ["Elephant", "Camel", "Giraffe", "Horse"], right: 2 },
  { q: "What is frozen water called?", answers: ["Steam", "Ice", "Mist", "Dew"], right: 1 },
  { q: "How many continents are there?", answers: ["5", "6", "7", "8"], right: 2 },
  { q: "Which is a primary colour?", answers: ["Green", "Red", "Pink", "Grey"], right: 1 },
  { q: "What do caterpillars turn into?", answers: ["Bees", "Beetles", "Butterflies", "Spiders"], right: 2 },
  { q: "Which month has the fewest days?", answers: ["February", "April", "June", "November"], right: 0 },
  { q: "What is the square root of 81?", answers: ["7", "8", "9", "10"], right: 2 },
  { q: "Which gas do we breathe in to live?", answers: ["Carbon dioxide", "Oxygen", "Helium", "Hydrogen"], right: 1 },
  { q: "How many hours are in a day?", answers: ["12", "20", "24", "36"], right: 2 },
];
`;

const TRIVIA = `import { seededRandom } from "../game/extras";
import { QUESTIONS, ROUND_SIZE, SECONDS, type Question } from "./questions";

/** One answer: which question of the round, the answer picked (-1 when time ran out), and how long it took. */
export interface Answer {
  q: number;
  pick: number;
  ms: number;
}

/** The round's questions, the same on every screen for the same seed. */
export function roundSet(seed: number): Question[] {
  const rand = seededRandom(seed);
  return QUESTIONS.map((q) => ({ q, k: rand() }))
    .sort((a, b) => a.k - b.k)
    .slice(0, ROUND_SIZE)
    .map((o) => o.q);
}

/** A right answer is 100 points plus 10 for each whole second left. Wrong or too slow is 0. */
export function points(question: Question, pick: number, ms: number): number {
  const left = Math.floor((SECONDS * 1000 - Math.max(0, ms)) / 1000);
  return pick === question.right && left >= 0 ? 100 + 10 * left : 0;
}

export interface Standing {
  wallet: string;
  name: string;
  score: number;
  answered: number;
  right: number;
}

/** Everyone's score from the answers, the same on every screen. Only a player's first answer to each question counts. */
export function standings(moves: Array<{ wallet: string; data: Answer }>, players: Array<{ wallet: string; name: string }>, set: Question[]): Standing[] {
  const rows = players.map((p) => ({ wallet: p.wallet, name: p.name, score: 0, answered: 0, right: 0 }));
  const seen = new Set<string>();
  for (const m of moves) {
    const row = rows.find((r) => r.wallet === m.wallet);
    const q = Math.floor(Number(m.data?.q));
    const question = set[q];
    if (!row || !question || seen.has(m.wallet + ":" + q)) continue;
    seen.add(m.wallet + ":" + q);
    const got = points(question, Math.floor(Number(m.data.pick)), Number(m.data.ms) || 0);
    row.answered++;
    row.score += got;
    if (got > 0) row.right++;
  }
  return rows.sort((a, b) => b.score - a.score);
}

/** When the round ends for everyone, even if someone left: each question's time plus a little to read. */
export function deadline(startedAt: number): number {
  return startedAt + ROUND_SIZE * (SECONDS + 3) * 1000;
}
`;

const ASK = `import { useEffect, useRef } from "react";
import type { Question } from "./questions";
import { SECONDS } from "./questions";

/**
 * One question with its clock. onAnswer(pick, ms) once: the answer tapped, or -1 when time runs out.
 * The clock draws its bar straight to the page, with no re-render every frame.
 */
export function Ask({ question, index, total, picked, onAnswer }: { question: Question; index: number; total: number; picked: number | null; onAnswer: (pick: number, ms: number) => void }) {
  const bar = useRef<HTMLDivElement>(null);
  const shown = useRef(performance.now());
  const answer = useRef(onAnswer);
  answer.current = onAnswer;

  useEffect(() => {
    shown.current = performance.now();
    if (picked !== null) return;
    let raf = 0;
    const tick = (now: number) => {
      const left = Math.max(0, SECONDS - (now - shown.current) / 1000);
      if (bar.current) bar.current.style.width = (left / SECONDS) * 100 + "%";
      if (left === 0) return answer.current(-1, SECONDS * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, picked]);

  return (
    <div className="space-y-3">
      <p className="text-sm tabular-nums text-muted-foreground">Question {index + 1}/{total}</p>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div ref={bar} className="h-full bg-primary" style={{ width: "100%" }} />
      </div>
      <p className="text-lg font-medium">{question.q}</p>
      <div data-game-area className="grid gap-2">
        {question.answers.map((a, i) => {
          const state = picked === null ? "" : i === question.right ? "bg-success text-white" : i === picked ? "bg-danger text-white" : "opacity-60";
          return (
            <button key={a} type="button" disabled={picked !== null} onClick={() => onAnswer(i, Math.round(performance.now() - shown.current))} className={"rounded-xl border bg-background px-4 py-3 text-left text-base font-medium " + state}>
              {a}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The live scores: highest first, you marked. */
export function Scores({ rows, me, total }: { rows: Array<{ key: string; name: string; score: number; answered: number }>; me: string; total: number }) {
  return (
    <ol className="space-y-1">
      {rows.map((r, i) => (
        <li key={r.key} className={"flex items-center justify-between rounded-lg px-3 py-1.5 text-sm tabular-nums " + (r.key === me ? "bg-primary/10 font-semibold" : "bg-background")}>
          <span>{i + 1}. {r.name}{r.key === me ? " (you)" : ""}</span>
          <span>{r.answered >= total ? "done" : r.answered + "/" + total} · {r.score}</span>
        </li>
      ))}
    </ol>
  );
}
`;

const ONLINE = `import { useEffect, useState } from "react";
import type { LiveRoom } from "../room/Lobby";
import { Ask, Scores } from "./Ask";
import { ROUND_SIZE } from "./questions";
import { deadline, roundSet, standings, type Answer } from "./trivia";

/** A round in a room: everyone answers the same questions at their own pace, with the scores live. */
export function OnlineTrivia({ live }: { live: LiveRoom<Answer> }) {
  const { room, me, players, moves } = live;
  const set = roundSet(room.seed);
  const rows = standings(moves, players, set);
  const mine = new Set(moves.filter((m) => m.wallet === me).map((m) => m.data.q));
  const [picked, setPicked] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const playing = room.players.includes(me);
  // The next question you haven't answered. Your answer shows for a moment before the next one.
  const at = Array.from({ length: ROUND_SIZE }, (_, i) => i).find((i) => !mine.has(i)) ?? ROUND_SIZE;
  const [showing, setShowing] = useState(at);
  const over = Date.now() > deadline(room.startedAt) || rows.every((r) => r.answered >= ROUND_SIZE);

  useEffect(() => {
    if (picked === null && showing !== at) setShowing(at);
  }, [at, picked, showing]);

  // While waiting for the others, look at the clock so the round ends on time even if someone left.
  useEffect(() => {
    if (over) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [over]);

  const answer = async (pick: number, ms: number) => {
    if (picked !== null || mine.has(showing)) return;
    setPicked(pick);
    setError(null);
    try {
      await live.send(showing, { q: showing, pick, ms });
    } catch {
      setError("Your answer didn't send. Check your connection.");
    }
    window.setTimeout(() => setPicked(null), 700);
  };

  const scoreRows = rows.map((r) => ({ key: r.wallet, name: r.name, score: r.score, answered: r.answered }));
  return (
    <div className="space-y-4">
      {!over && playing && showing < ROUND_SIZE && <Ask question={set[showing]} index={showing} total={ROUND_SIZE} picked={picked} onAnswer={(p, ms) => void answer(p, ms)} />}
      {!over && (!playing || showing >= ROUND_SIZE) && <p className="text-sm text-muted-foreground">Waiting for the others to finish... ({Math.max(0, Math.ceil((deadline(room.startedAt) - now) / 1000))}s at most)</p>}
      {over && <p className="text-xl font-semibold">{rows[0]?.wallet === me ? "You win!" : (rows[0]?.name ?? "Nobody") + " wins"}</p>}
      <Scores rows={scoreRows} me={me} total={ROUND_SIZE} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {over &&
        (live.isHost ? (
          <button type="button" className="w-full rounded-xl bg-primary px-5 py-3 font-semibold text-primary-foreground" onClick={() => void live.rematch()}>
            Rematch
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">The host can start a rematch.</p>
        ))}
    </div>
  );
}
`;

const GAME = `import { useRef, useState } from "react";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { buzz } from "../game/haptics";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { RoomLobby } from "../room/Lobby";
import { Ask, Scores } from "./Ask";
import { OnlineTrivia } from "./Online";
import { BEST_KEY, BOTS, GAME_NAME, ROUND_SIZE, SECONDS } from "./questions";
import { points, roundSet, type Answer } from "./trivia";

// A turn-based game played with answer buttons, against computer players or friends in a room. Keep this in step with the game.
declareGame({ style: "turns", controls: ["buttons"], npcs: ["computer"] });

const ROOM = { game: "answer-rush", min: 2, max: 8 };

type Screen = "start" | "playing" | "over";
type Row = { key: string; name: string; score: number; answered: number };

const fresh = (): Row[] => [{ key: "you", name: "You", score: 0, answered: 0 }, ...BOTS.map((b) => ({ key: b.name, name: b.name, score: 0, answered: 0 }))];

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [set, setSet] = useState(() => roundSet(Date.now()));
  const [at, setAt] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>(fresh);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [inRoom, setInRoom] = useState(false);
  const rowsRef = useRef<Row[]>(fresh());

  const you = rows.find((r) => r.key === "you")!;

  const start = () => {
    rowsRef.current = fresh();
    setRows(rowsRef.current);
    setSet(roundSet(Date.now()));
    setAt(0);
    setPicked(null);
    setScreen("playing");
    round(true);
    probe(0);
    spawned("computer");
    sfx.tap();
  };

  /** Your answer (or -1 when time ran out), then the computer players answer the same question. */
  const answer = (pick: number, ms: number) => {
    if (screen !== "playing" || picked !== null) return;
    if (pick >= 0) moved();
    setPicked(pick);
    const question = set[at];
    const next = rowsRef.current.map((r) => {
      const bot = BOTS.find((b) => b.name === r.key);
      const got = bot ? (Math.random() < bot.skill ? points(question, question.right, 2000 + Math.random() * (SECONDS - 4) * 1000) : 0) : points(question, pick, ms);
      return { ...r, score: r.score + got, answered: r.answered + 1 };
    });
    rowsRef.current = next;
    setRows(next);
    const mine = next.find((r) => r.key === "you")!.score;
    probe(mine);
    if (pick === question.right) {
      sfx.coin();
      buzz("collect");
    } else {
      sfx.hit();
      buzz("hit");
    }
    window.setTimeout(() => {
      setPicked(null);
      if (at + 1 >= set.length) {
        probe(mine);
        round(false);
        if (saveBest(mine, BEST_KEY)) setBest(mine);
        sfx.win();
        setScreen("over");
      } else setAt((n) => n + 1);
    }, 600);
  };

  const sorted = [...rows].sort((a, b) => b.score - a.score);
  const place = sorted.findIndex((r) => r.key === "you") + 1;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        {screen === "start" && (
          <div className="space-y-5">
            {!inRoom && (
              <GameMenu
                card={false}
                title={GAME_NAME}
                tagline={ROUND_SIZE + " questions, the same for everyone."}
                best={best}
                onPlay={start}
                playLabel="Play the computer"
                howTo={["Everyone gets the same " + ROUND_SIZE + " questions, " + SECONDS + " seconds each.", "Tap the answer you think is right. Right and fast scores most.", "Everyone's score shows live. The highest score when the round ends wins.", "Play three computer players alone, or make a room below and send friends the code."]}
              />
            )}
            <div className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">With friends (2 to 8)</h3>
              <RoomLobby<Answer> config={ROOM} onRoom={setInRoom}>
                {(live) => <OnlineTrivia live={live} />}
              </RoomLobby>
            </div>
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-4">
            <p className="text-3xl font-semibold tabular-nums">{you.score}</p>
            {screen === "playing" && <Ask question={set[at]} index={at} total={set.length} picked={picked} onAnswer={answer} />}
            <Scores rows={sorted} me="you" total={set.length} />
          </div>
        )}
        {screen === "over" && (
          <GameOver score={you.score} best={best} stats={[{ label: "Place", value: place + " of " + rows.length }]} onAgain={start} shareText={"I scored " + you.score + " in " + GAME_NAME} />
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
    </div>
  );
}
`;

export const triviaBattle: GameTemplate = {
  id: "trivia-battle",
  name: "Trivia battle",
  dims: "2d",
  style: "turns",
  fits: "quizzes and trivia played by 2 to 8 people together: friends join a room by code, everyone answers the same questions, scores live, or against computer players",
  kits: ["game-2d"],
  files: {
    ...ROOM_FILES,
    "src/App.tsx": appFor("./play/questions", "GAME_NAME"),
    "src/play/questions.ts": QUESTIONS,
    "src/play/trivia.ts": TRIVIA,
    "src/play/Ask.tsx": ASK,
    "src/play/Online.tsx": ONLINE,
    "src/play/Game.tsx": GAME,
  },
  rules: ROOM_RULES,
  multiplayer: true,
  title: { from: "./play/questions", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Trivia battle template, a working, tested game for 2 to 8: src/play/questions.ts (the name, the rules' numbers and the questions), src/play/trivia.ts (the round's questions and the scores), src/play/Ask.tsx (a question and the live scores), src/play/Online.tsx (a round with friends), src/play/Game.tsx (the start screen and the round against computer players) and src/room/ (the room). Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY, and ROOM.game in Game.tsx), write the questions about the plan's topic in questions.ts (at least 12, four short answers each, facts you are sure of), restyle it to the plan's look, and change the numbers the plan asks for (seconds per question, questions per round, the computer players).
- ${ROOM_BRIEF}
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every answer, probe(score) when the score changes, the answers inside <div data-game-area>, GameOver with Play again, free play with no wallet.`,
};
