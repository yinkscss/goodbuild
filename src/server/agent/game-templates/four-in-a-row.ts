import type { GameTemplate } from "./index";
import { ROOM_BRIEF, ROOM_FILES, ROOM_RULES } from "./room";
import { appFor } from "./shared";

/**
 * Four in a row (D139, PR 5): two players drop discs into a 7 x 6 grid, four in a line wins. Online in a
 * room with a friend (turns worked out from the moves), or against the computer, which is what the run
 * check plays. Original name and look; a "turns" game played with buttons, reporting its own rounds.
 */

const RULES = `// The rules of four in a row, with no screen: the board, a drop, the winner and the computer's move.

export const GAME_NAME = "Line Up Four";
export const BEST_KEY = "line-up-four";
export const COLS = 7;
export const ROWS = 6;

/** 0 empty, 1 the first player, 2 the second. Index row * COLS + col, row 0 at the top. */
export type Cell = 0 | 1 | 2;

export function emptyBoard(): Cell[] {
  return new Array<Cell>(COLS * ROWS).fill(0);
}

/** The row a disc dropped in this column lands on, or -1 when the column is full. */
export function landing(board: Cell[], col: number): number {
  if (col < 0 || col >= COLS) return -1;
  for (let row = ROWS - 1; row >= 0; row--) if (board[row * COLS + col] === 0) return row;
  return -1;
}

/** The board after who drops in col, or null when that column is full. */
export function drop(board: Cell[], col: number, who: 1 | 2): Cell[] | null {
  const row = landing(board, col);
  if (row < 0) return null;
  const next = board.slice();
  next[row * COLS + col] = who;
  return next;
}

const LINES: number[][] = (() => {
  const lines: number[][] = [];
  const ways = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of ways) {
        const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
        if (cells.every(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS)) lines.push(cells.map(([rr, cc]) => rr * COLS + cc));
      }
  return lines;
})();

/** Four in a line: who made it and which cells. */
export function winner(board: Cell[]): { who: 1 | 2; line: number[] } | null {
  for (const line of LINES) {
    const who = board[line[0]];
    if (who && line.every((i) => board[i] === who)) return { who, line };
  }
  return null;
}

export const full = (board: Cell[]) => board.every((c) => c !== 0);

/** The computer: win if it can, block a win, never hand one over, else near the middle with a little luck. */
export function computerMove(board: Cell[], me: 1 | 2): number {
  const them: 1 | 2 = me === 1 ? 2 : 1;
  const open = [3, 2, 4, 1, 5, 0, 6].filter((c) => landing(board, c) >= 0);
  const wins = (b: Cell[], who: 1 | 2) => open.find((c) => { const n = drop(b, c, who); return n !== null && winner(n)?.who === who; });
  const win = wins(board, me);
  if (win !== undefined) return win;
  const block = wins(board, them);
  if (block !== undefined) return block;
  const safe = open.filter((c) => {
    const n = drop(board, c, me)!;
    return !open.some((d) => { const m = drop(n, d, them); return m !== null && winner(m)?.who === them; });
  });
  const pool = safe.length ? safe : open;
  // Mostly the most central safe column, sometimes the next one, so no two games are the same.
  return pool[Math.random() < 0.7 || pool.length === 1 ? 0 : 1];
}

export interface Drop {
  col: number;
}

/**
 * A room's board from its moves, the same on every screen. Move n belongs to players[n % 2]; a move by
 * the wrong player, for a full column, or for a turn already taken (the later of two) is left out.
 */
export function replay(moves: Array<{ wallet: string; n: number; data: Drop }>, players: string[]) {
  let board = emptyBoard();
  let turn = 0;
  /** Moves left out: too late, out of turn, or for a full column. */
  const late: typeof moves = [];
  for (const m of moves) {
    const next = winner(board) || full(board) || m.n !== turn || m.wallet !== players[turn % 2] ? null : drop(board, Math.floor(Number(m.data?.col)), ((turn % 2) + 1) as 1 | 2);
    if (!next) {
      late.push(m);
      continue;
    }
    board = next;
    turn++;
  }
  return { board, turn, late, win: winner(board), draw: !winner(board) && full(board) };
}
`;

const BOARD = `import { COLS, ROWS, type Cell } from "./rules";

const DISC = ["bg-background", "bg-primary", "bg-accent"];

/** The grid. Tap a column's button to drop a disc there. */
export function Board({ board, line = [], canDrop, onDrop }: { board: Cell[]; line?: number[]; canDrop: (col: number) => boolean; onDrop: (col: number) => void }) {
  return (
    <div className="rounded-2xl bg-primary/15 p-2">
      <div data-game-area className="grid grid-cols-7 gap-1">
        {Array.from({ length: COLS }, (_, col) => (
          <button
            key={col}
            type="button"
            aria-label={"Drop in column " + (col + 1)}
            disabled={!canDrop(col)}
            onClick={() => onDrop(col)}
            className="flex flex-col gap-1 rounded-lg p-0.5 enabled:hover:bg-primary/10 disabled:cursor-default"
          >
            {Array.from({ length: ROWS }, (_, row) => {
              const i = row * COLS + col;
              return <span key={row} className={"block aspect-square w-full rounded-full shadow-inner transition-colors " + DISC[board[i]] + (line.includes(i) ? " ring-4 ring-warning" : "")} />;
            })}
          </button>
        ))}
      </div>
    </div>
  );
}
`;

const ONLINE = `import { useState } from "react";
import type { LiveRoom } from "../room/Lobby";
import { Board } from "./Board";
import { landing, replay, type Drop } from "./rules";

/** A round with a friend in a room. Whose turn it is comes from the moves, the same on both screens. */
export function OnlineFour({ live }: { live: LiveRoom<Drop> }) {
  const { room, me, players, moves } = live;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = replay(moves, room.players);
  const seat = room.players.indexOf(me);
  const myTurn = seat >= 0 && state.turn % 2 === seat && !state.win && !state.draw;
  const name = (i: number) => players[i]?.name ?? "Player " + (i + 1);
  const tooLate = state.late.some((m) => m.wallet === me);

  const play = async (col: number) => {
    if (!myTurn || sending || landing(state.board, col) < 0) return;
    setSending(true);
    setError(null);
    try {
      await live.send(state.turn, { col });
    } catch {
      setError("That move didn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  const status = state.win
    ? (room.players[state.win.who - 1] === me ? "You win!" : name(state.win.who - 1) + " wins")
    : state.draw
    ? "A draw: the board is full"
    : myTurn
    ? "Your turn"
    : seat < 0
    ? name(state.turn % 2) + " to play"
    : "Waiting for " + name(state.turn % 2) + "...";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span><span className="mr-1 inline-block h-3 w-3 rounded-full bg-primary" />{name(0)}</span>
        <span>{name(1)}<span className="ml-1 inline-block h-3 w-3 rounded-full bg-accent" /></span>
      </div>
      <p className="text-lg font-semibold" aria-live="polite">{status}</p>
      <Board board={state.board} line={state.win?.line} canDrop={(c) => myTurn && !sending && landing(state.board, c) >= 0} onDrop={(c) => void play(c)} />
      {tooLate && <p className="text-xs text-muted-foreground">A move of yours came too late and was left out.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {(state.win || state.draw) &&
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
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { buzz } from "../game/haptics";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { RoomLobby } from "../room/Lobby";
import { Board } from "./Board";
import { OnlineFour } from "./Online";
import { BEST_KEY, GAME_NAME, computerMove, drop, emptyBoard, full, landing, winner, type Cell, type Drop } from "./rules";

// A turn-based game played with buttons, against the computer or a friend in a room. Keep this in step with the game.
declareGame({ style: "turns", controls: ["buttons"], npcs: ["computer"] });

/** Points: 5 for each disc you drop, and for a win 100 plus 5 for each disc you didn't need. */
const PER_DISC = 5;
const ROOM = { game: "line-up-four", min: 2, max: 2 };

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [board, setBoard] = useState<Cell[]>(() => emptyBoard());
  const [thinking, setThinking] = useState(false);
  const [result, setResult] = useState<"win" | "lose" | "draw">("lose");
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [inRoom, setInRoom] = useState(false);
  const scoreRef = useRef(0);
  const timer = useRef(0);

  const finish = (final: number, how: "win" | "lose" | "draw") => {
    probe(final);
    round(false);
    setResult(how);
    if (saveBest(final, BEST_KEY)) setBest(final);
    if (how === "win") sfx.win();
    else sfx.hit();
    setScreen("over");
  };

  const start = () => {
    window.clearTimeout(timer.current);
    scoreRef.current = 0;
    setScore(0);
    setBoard(emptyBoard());
    setThinking(false);
    setScreen("playing");
    round(true);
    probe(0);
    spawned("computer");
    sfx.tap();
  };

  const play = (col: number) => {
    if (screen !== "playing" || thinking) return;
    const mine = drop(board, col, 1);
    if (!mine) return;
    moved();
    buzz("collect");
    sfx.coin();
    const discs = mine.filter((c) => c === 1).length;
    scoreRef.current += PER_DISC;
    setScore(scoreRef.current);
    probe(scoreRef.current);
    setBoard(mine);
    if (winner(mine)) {
      scoreRef.current += 100 + PER_DISC * (21 - discs);
      setScore(scoreRef.current);
      return finish(scoreRef.current, "win");
    }
    if (full(mine)) return finish(scoreRef.current, "draw");
    setThinking(true);
    timer.current = window.setTimeout(() => {
      const theirs = drop(mine, computerMove(mine, 2), 2)!;
      setBoard(theirs);
      setThinking(false);
      if (winner(theirs)) finish(scoreRef.current, "lose");
      else if (full(theirs)) finish(scoreRef.current, "draw");
    }, 350);
  };

  const line = winner(board)?.line ?? [];

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        {screen === "start" && (
          <div className="space-y-5">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold">{GAME_NAME}</h2>
              <p className="text-muted-foreground">Drop discs in turn. Four in a line, across, down or slanted, wins.</p>
              {best > 0 && <p className="text-sm">Your best: {best}</p>}
            </div>
            {!inRoom && (
              <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
                Play the computer
              </button>
            )}
            <div className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">With a friend</h3>
              <RoomLobby<Drop> config={ROOM} onRoom={setInRoom}>
                {(live) => <OnlineFour live={live} />}
              </RoomLobby>
            </div>
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm tabular-nums">
              <span><span className="mr-1 inline-block h-3 w-3 rounded-full bg-primary" />You</span>
              <span className="text-2xl font-semibold">{score}</span>
              <span>Computer<span className="ml-1 inline-block h-3 w-3 rounded-full bg-accent" /></span>
            </div>
            <p className="text-sm text-muted-foreground" aria-live="polite">{screen === "over" ? "" : thinking ? "The computer is thinking..." : "Your turn: tap a column"}</p>
            <Board board={board} line={line} canDrop={(c) => screen === "playing" && !thinking && landing(board, c) >= 0} onDrop={play} />
          </div>
        )}
        {screen === "over" && (
          <GameOver
            score={score}
            best={best}
            stats={[{ label: "Result", value: result === "win" ? "You won" : result === "draw" ? "Draw" : "Computer won" }]}
            onAgain={start}
            shareText={"I scored " + score + " in " + GAME_NAME}
          />
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
    </div>
  );
}
`;

export const fourInARow: GameTemplate = {
  id: "four-in-a-row",
  name: "Four in a row",
  dims: "2d",
  style: "turns",
  fits: "two-player board games of dropping or placing pieces to make a line (four in a row, five in a row, tic-tac-toe style), played with a friend in a room by code, or against the computer",
  kits: ["game-2d"],
  files: { ...ROOM_FILES, "src/App.tsx": appFor("./play/rules", "GAME_NAME"), "src/play/rules.ts": RULES, "src/play/Board.tsx": BOARD, "src/play/Online.tsx": ONLINE, "src/play/Game.tsx": GAME },
  rules: ROOM_RULES,
  multiplayer: true,
  title: { from: "./play/rules", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Four in a row template, a working, tested game for two: src/play/rules.ts (the name, the board, the winner, the computer), src/play/Board.tsx (the grid), src/play/Online.tsx (a round with a friend), src/play/Game.tsx (the start screen, the game against the computer) and src/room/ (the room). Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY, and ROOM.game in Game.tsx), restyle the board and discs to the plan's look, and change the rules the plan asks for (the grid's size, how many in a line) in rules.ts, where both modes read them.
- ${ROOM_BRIEF}
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every drop, probe(score) when the score changes, the column buttons inside <div data-game-area>, GameOver with Play again, free play with no wallet.`,
};
