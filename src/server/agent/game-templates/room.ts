/**
 * The multiplayer room (D139, PR 5): a shared lobby that room games are built on. Wallet sign-in,
 * a room with a short code, others join by code, ready up, the host starts, rematch. There is no live
 * connection (D79): every screen asks for the room's records every 3 seconds and works out the same
 * state from them, as the multiplayer guide says. Shared by every multiplayer template.
 *
 * Generated code below avoids backticks, "${" and backslashes, so it reads as written.
 */

/** The three collections, for src/lib/dataRules.json. Everyone reads them; each person writes only their own. */
export const ROOM_RULES = {
  rooms: {
    create: "signed-in",
    read: ["anyone"],
    fields: { code: "string", game: "string", name: "string", max: "number", status: "string", round: "number", players: "string", seed: "number", startedAt: "number" },
    unique: ["code"],
  },
  seats: {
    create: "signed-in",
    read: ["anyone"],
    fields: { code: "string", name: "string", ready: "number", left: "boolean" },
  },
  moves: {
    create: "signed-in",
    read: ["anyone"],
    update: [],
    fields: { code: "string", round: "number", n: "number", data: "string" },
  },
} as const;

const ROOM_TS = `import { collection, DbError, type DbRecord } from "../lib/db";

/**
 * A room for 2 or more people (GoodBuild's room template). There is no live connection: every screen
 * asks for the room's records every few seconds and works out the same state from them.
 * - rooms: the host's record, key = the room code: the game, the status, the round, who plays.
 * - seats: each player's own record, key = the room code: their name and the round they're ready for.
 * - moves: each move is its own record: the room code, the round, its number n and the move as JSON.
 * Nobody edits anyone else's record, so nothing needs a lock. Moves come from players' own devices:
 * a winner worked out here is a result between friends, never proof for money or prizes.
 * The rules for these collections are in src/lib/dataRules.json: keep them as they are.
 */

/** How often the room asks for news, in milliseconds (never less than 2000). */
export const LIVE_MS = 3000;
export const CODE_LENGTH = 5;
/** No 0/O or 1/I/L, so a code read out loud is typed right. */
const CODE_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export interface RoomConfig {
  /** Which game the room is for, so a code from another game in the same app isn't joined by mistake. */
  game: string;
  min: number;
  max: number;
}

export interface RoomValue {
  code: string;
  game: string;
  name: string;
  max: number;
  status: string;
  round: number;
  players: string;
  seed: number;
  startedAt: number;
}
export interface SeatValue {
  code: string;
  name: string;
  ready: number;
  left: boolean;
}
export interface MoveValue {
  code: string;
  round: number;
  n: number;
  data: string;
}

/** open: in the lobby. playing: a round is on. closed: the host left. */
export type RoomStatus = "open" | "playing" | "closed";

export interface Room {
  code: string;
  game: string;
  /** The host's wallet and name. */
  host: string;
  hostName: string;
  max: number;
  status: RoomStatus;
  /** Goes up by one at each rematch; moves and ready marks belong to one round. */
  round: number;
  /** The wallets playing this round, in turn order. Set by the host at Start. */
  players: string[];
  /** The same random number on every screen, for anything shuffled (question order, who goes first). */
  seed: number;
  startedAt: number;
}

export interface Seat {
  wallet: string;
  name: string;
  /** Ready for this round. The host is always ready. */
  ready: boolean;
  joinedAt: number;
}

export interface Move<T> {
  wallet: string;
  n: number;
  data: T;
  at: number;
}

export function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_LETTERS[b % CODE_LETTERS.length]).join("");
}

/** What someone typed, as a code: capitals, only the code's letters. */
export function cleanCode(text: string): string {
  return text
    .toUpperCase()
    .split("")
    .filter((ch) => CODE_LETTERS.includes(ch))
    .join("")
    .slice(0, CODE_LENGTH);
}

/** A name that is safe to show: printable, no angle brackets, at most 16 characters. */
export function cleanName(text: string): string {
  return Array.from(text)
    .filter((ch) => ch >= " " && ch !== "<" && ch !== ">" && ch !== String.fromCharCode(127))
    .join("")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, 16);
}

const NAME_KEY = "room:name";
export function savedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}
function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage is blocked: the name just isn't remembered */
  }
}

const time = (iso: string) => Date.parse(iso) || 0;
const asStatus = (s: string): RoomStatus => (s === "playing" || s === "closed" ? s : "open");

/** The room with this code: the first one made, if two ever were. */
export function roomOf(records: DbRecord<RoomValue>[], code: string | null): Room | null {
  const found = records
    .filter((r) => r.owner && r.value && r.value.code === code)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt))[0];
  if (!found) return null;
  const v = found.value;
  let players: string[] = [];
  try {
    const list = JSON.parse(v.players || "[]") as unknown;
    if (Array.isArray(list)) players = list.filter((p): p is string => typeof p === "string").map((p) => p.toLowerCase());
  } catch {
    players = [];
  }
  return {
    code: v.code,
    game: String(v.game),
    host: found.owner!.toLowerCase(),
    hostName: cleanName(String(v.name)) || "Host",
    max: Math.max(2, Math.min(10, Number(v.max) || 2)),
    status: asStatus(String(v.status)),
    round: Math.max(1, Math.floor(Number(v.round) || 1)),
    players,
    seed: Math.floor(Number(v.seed) || 0),
    startedAt: Number(v.startedAt) || 0,
  };
}

/** Everyone in the room, in the order they joined, the host first. Those past the room's size only watch. */
export function seatsOf(records: DbRecord<SeatValue>[], room: Room | null): Seat[] {
  if (!room) return [];
  const seats = records
    .filter((r) => r.owner && r.value && r.value.code === room.code && !r.value.left)
    .map((r) => ({
      wallet: r.owner!.toLowerCase(),
      name: cleanName(String(r.value.name)) || "Player",
      ready: r.owner!.toLowerCase() === room.host || r.value.ready === room.round,
      joinedAt: time(r.createdAt),
    }))
    .sort((a, b) => (a.wallet === room.host ? -1 : b.wallet === room.host ? 1 : a.joinedAt - b.joinedAt));
  return seats.filter((s, i) => seats.findIndex((t) => t.wallet === s.wallet) === i);
}

/** This round's moves by its players, in order: by n, then the earlier one. Unreadable ones are skipped. */
export function movesOf<T>(records: DbRecord<MoveValue>[], room: Room | null): Move<T>[] {
  if (!room) return [];
  const moves: Move<T>[] = [];
  for (const r of records) {
    const wallet = r.owner?.toLowerCase();
    if (!wallet || !r.value || r.value.code !== room.code || r.value.round !== room.round || !room.players.includes(wallet)) continue;
    try {
      moves.push({ wallet, n: Math.floor(Number(r.value.n)), data: JSON.parse(r.value.data) as T, at: time(r.createdAt) });
    } catch {
      /* a move that isn't JSON is no move */
    }
  }
  return moves.sort((a, b) => a.n - b.n || a.at - b.at);
}

/** Whether the host can start, and if not, why, in words for the button. */
export function startCheck(room: Room, seats: Seat[], config: RoomConfig): { ok: boolean; why: string } {
  const playing = seats.slice(0, room.max);
  if (playing.length < config.min) return { ok: false, why: "Waiting for " + (config.min - playing.length) + " more to join" };
  const waiting = playing.filter((s) => !s.ready).length;
  if (waiting) return { ok: false, why: "Waiting for " + waiting + " to be ready" };
  return { ok: true, why: "" };
}

const rooms = () => collection<RoomValue>("rooms");
const seats = () => collection<SeatValue>("seats");
const moves = () => collection<MoveValue>("moves");

async function findRoom(code: string): Promise<Room | null> {
  const page = await rooms().list({ where: [["code", "eq", code]], limit: 5 });
  return roomOf(page.records, code);
}

/** Make a room and take the first seat. Returns its code. The person must be signed in. */
export async function createRoom(config: RoomConfig, name: string): Promise<string> {
  const clean = cleanName(name) || "Host";
  saveName(clean);
  for (let attempt = 0; ; attempt++) {
    const code = newCode();
    try {
      await rooms().put(code, { code, game: config.game, name: clean, max: config.max, status: "open", round: 1, players: "[]", seed: 0, startedAt: 0 });
      await seats().put(code, { code, name: clean, ready: 1, left: false });
      return code;
    } catch (e) {
      // Another room has this code: try another. Anything else is shown to the person.
      if (!(e instanceof DbError && e.code === "duplicate") || attempt >= 4) throw e;
    }
  }
}

/** Take a seat in a room by its code. Throws with a message to show when there's no such room. */
export async function joinRoom(config: RoomConfig, code: string, name: string): Promise<string> {
  const clean = cleanName(name) || "Player";
  saveName(clean);
  const room = await findRoom(cleanCode(code));
  if (!room || room.status === "closed") throw new Error("There's no open room with the code " + cleanCode(code) + ". Check it with the host.");
  if (room.game !== config.game) throw new Error("That code is for a different game in this app.");
  await seats().put(room.code, { code: room.code, name: clean, ready: 0, left: false });
  return room.code;
}

/** Ready or not for this round. */
export async function setReady(room: Room, name: string, ready: boolean): Promise<void> {
  await seats().put(room.code, { code: room.code, name, ready: ready ? room.round : 0, left: false });
}

/** The host starts the round with everyone seated, in the order they joined. */
export async function startRound(room: Room, seated: Seat[]): Promise<void> {
  const players = seated.slice(0, room.max).map((s) => s.wallet);
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  await rooms().put(room.code, { code: room.code, game: room.game, name: room.hostName, max: room.max, status: "playing", round: room.round, players: JSON.stringify(players), seed, startedAt: Date.now() });
}

/** The host takes everyone back to the lobby for another round: everyone readies up again. */
export async function rematch(room: Room): Promise<void> {
  await rooms().put(room.code, { code: room.code, game: room.game, name: room.hostName, max: room.max, status: "open", round: room.round + 1, players: "[]", seed: 0, startedAt: 0 });
}

/** One move, as its own record. Two players may send the same n: every screen keeps the earlier one. */
export async function sendMove<T>(room: Room, n: number, data: T): Promise<void> {
  await moves().add({ code: room.code, round: room.round, n, data: JSON.stringify(data) });
}

/** Leave the room. When the host leaves, the room closes for everyone. */
export async function leaveRoom(room: Room, me: string, name: string): Promise<void> {
  await seats().put(room.code, { code: room.code, name, ready: 0, left: true });
  if (me === room.host) await rooms().put(room.code, { code: room.code, game: room.game, name: room.hostName, max: room.max, status: "closed", round: room.round, players: "[]", seed: room.seed, startedAt: room.startedAt });
}
`;

const USE_ROOM_TS = `import { useCollection, useDbSession } from "../lib/useDb";
import { LIVE_MS, movesOf, roomOf, seatsOf, type MoveValue, type RoomValue, type SeatValue } from "./room";

/**
 * The room with this code, kept up to date: it asks for news every LIVE_MS while the page shows.
 * Everything is worked out from the records, the same way on every screen.
 */
export function useRoom<T>(code: string | null) {
  const session = useDbSession();
  const me = session.wallet?.toLowerCase() ?? null;
  const on = Boolean(code && me);
  const where = [["code", "eq", code ?? ""]] as Array<[string, "eq", string]>;
  const roomRecords = useCollection<RoomValue>("rooms", { enabled: on, where, limit: 5, liveEvery: LIVE_MS, wallet: me });
  const seatRecords = useCollection<SeatValue>("seats", { enabled: on, where, orderBy: "createdAt", dir: "asc", limit: 50, liveEvery: LIVE_MS, wallet: me });
  const room = roomOf(roomRecords.records, code);
  const playing = room?.status === "playing";
  const moveRecords = useCollection<MoveValue>("moves", {
    enabled: on && playing,
    where: [["code", "eq", code ?? ""], ["round", "eq", room?.round ?? 0]],
    orderBy: "n",
    dir: "asc",
    limit: 100,
    liveEvery: LIVE_MS,
    wallet: me,
  });
  const seats = seatsOf(seatRecords.records, room);
  const refresh = async () => {
    await Promise.all([roomRecords.refresh(), seatRecords.refresh(), playing ? moveRecords.refresh() : Promise.resolve()]);
  };
  return {
    me,
    room,
    seats,
    moves: movesOf<T>(playing ? moveRecords.records : [], room),
    /** First load, before anything came back. */
    loading: on && roomRecords.loading && !roomRecords.records.length,
    /** The last fetch failed: show "Reconnecting..." and keep the last good state on screen. */
    offline: Boolean(roomRecords.error || seatRecords.error || moveRecords.error),
    refresh,
  };
}

export type RoomState<T> = ReturnType<typeof useRoom<T>>;
`;

const LOBBY_TSX = `import { useEffect, useState, type ReactNode } from "react";
import { errorMessage } from "../lib/format";
import { isMiniPay } from "../lib/goodbuild/wallet";
import { useDbSession } from "../lib/useDb";
import { shortAddress } from "../lib/utils";
import { cleanCode, createRoom, joinRoom, leaveRoom, rematch, savedName, sendMove, setReady, startCheck, startRound, CODE_LENGTH, type Move, type Room, type RoomConfig, type Seat } from "./room";
import { useRoom } from "./useRoom";

/** What a room game gets once the host has started: everything it needs to draw and play a round. */
export interface LiveRoom<T> {
  room: Room;
  me: string;
  /** This round's players, in turn order, with their names. */
  players: Seat[];
  moves: Move<T>[];
  isHost: boolean;
  send: (n: number, data: T) => Promise<void>;
  /** The host only: back to the lobby for another round. */
  rematch: () => Promise<void>;
  /** The last fetch failed; the game keeps showing the last good state. */
  offline: boolean;
}

const CODE_KEY = "room:code";
function rememberCode(code: string | null) {
  try {
    if (code) sessionStorage.setItem(CODE_KEY, code);
    else sessionStorage.removeItem(CODE_KEY);
  } catch {
    /* storage is blocked: a reload goes back to the menu */
  }
}
function rememberedCode(): string | null {
  try {
    return sessionStorage.getItem(CODE_KEY);
  } catch {
    return null;
  }
}

const btn = "w-full rounded-xl bg-primary px-5 py-3 text-base font-semibold text-primary-foreground disabled:opacity-50";
const quiet = "w-full rounded-xl bg-background px-5 py-3 text-base font-medium shadow-sm disabled:opacity-50";

/**
 * Play with friends: sign in, make a room or join one by its code, ready up, and the host starts.
 * Once a round is on, children(live) draws the game. Inside MiniPay rooms aren't offered: they need a
 * sign-in signature, which MiniPay doesn't allow.
 */
export function RoomLobby<T>({ config, onRoom, children }: { config: RoomConfig; onRoom?: (inRoom: boolean) => void; children: (live: LiveRoom<T>) => ReactNode }) {
  const session = useDbSession();
  const [code, setCode] = useState<string | null>(() => rememberedCode());
  const [name, setName] = useState(() => savedName());
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useRoom<T>(code);
  const { room, seats, me } = state;

  useEffect(() => {
    rememberCode(code);
    onRoom?.(Boolean(code));
  }, [code, onRoom]);

  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await step();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (isMiniPay()) {
    return <p className="rounded-xl bg-muted p-4 text-sm">Rooms with friends need a sign-in MiniPay doesn't allow yet. Open this game in a browser to play friends.</p>;
  }

  if (!session.signedIn || !me) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">Sign in with your wallet to make or join a room. It's one free signature, no fee.</p>
        <button type="button" className={btn} disabled={session.signingIn || session.loading} onClick={() => void session.signIn()}>
          {session.signingIn ? "Check your wallet..." : "Sign in with wallet"}
        </button>
        {session.error && <p role="alert" className="text-sm text-danger">{session.error}</p>}
      </div>
    );
  }

  const leave = () =>
    run(async () => {
      if (room) await leaveRoom(room, me, seats.find((s) => s.wallet === me)?.name ?? name);
      setCode(null);
    });

  if (!code) {
    return (
      <div className="space-y-3">
        <label className="block text-sm font-medium">
          Your name
          <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="Ada" className="mt-1 w-full rounded-xl border bg-background px-3 py-2" />
        </label>
        <button type="button" className={btn} disabled={busy || !name.trim()} onClick={() => run(async () => setCode(await createRoom(config, name)))}>
          Make a room
        </button>
        <div className="flex gap-2">
          <input
            aria-label="Room code"
            value={typed}
            onChange={(e) => setTyped(cleanCode(e.target.value))}
            placeholder="CODE"
            className="w-full rounded-xl border bg-background px-3 py-2 font-mono text-lg uppercase tracking-widest"
          />
          <button type="button" className={quiet + " w-auto"} disabled={busy || !name.trim() || typed.length !== CODE_LENGTH} onClick={() => run(async () => setCode(await joinRoom(config, typed, name)))}>
            Join
          </button>
        </div>
        <p className="text-xs text-muted-foreground">Signed in as {shortAddress(me)}</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (!room) {
    return (
      <div className="space-y-3">
        <p className="text-sm">{state.loading ? "Opening room " + code + "..." : "Room " + code + " isn't there any more."}</p>
        <button type="button" className={quiet} onClick={() => setCode(null)}>
          Back
        </button>
      </div>
    );
  }

  const isHost = room.host === me;
  const seated = seats.slice(0, room.max);
  const mine = seats.find((s) => s.wallet === me);
  const watching = !seated.some((s) => s.wallet === me);
  const status = state.offline ? <p className="text-xs text-warning">Reconnecting...</p> : null;

  if (room.status === "closed") {
    return (
      <div className="space-y-3">
        <p className="text-sm">The host closed room {room.code}.</p>
        <button type="button" className={quiet} onClick={() => setCode(null)}>
          Back
        </button>
      </div>
    );
  }

  if (room.status === "playing") {
    const players = room.players.map((w) => seats.find((s) => s.wallet === w) ?? { wallet: w, name: shortAddress(w), ready: true, joinedAt: 0 });
    return (
      <div className="space-y-3">
        {status}
        {children({
          room,
          me,
          players,
          moves: state.moves,
          isHost,
          offline: state.offline,
          send: async (n, data) => {
            await sendMove(room, n, data);
            await state.refresh();
          },
          rematch: async () => {
            await rematch(room);
            await state.refresh();
          },
        })}
        <button type="button" className="text-sm underline" onClick={() => void leave()}>
          Leave room
        </button>
      </div>
    );
  }

  const can = startCheck(room, seats, config);
  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-muted p-4 text-center">
        <p className="text-xs uppercase tracking-widest text-muted-foreground">Room code</p>
        <p data-room-code className="font-mono text-4xl font-bold tracking-[0.3em]">{room.code}</p>
        <p className="mt-1 text-xs text-muted-foreground">Friends join with this code. {room.max} players at most.</p>
      </div>
      {status}
      <ul className="space-y-1">
        {seats.map((s, i) => (
          <li key={s.wallet} className="flex items-center justify-between rounded-lg bg-background px-3 py-2 text-sm">
            <span>
              {s.name}
              {s.wallet === room.host ? " (host)" : ""}
              {s.wallet === me ? " (you)" : ""}
            </span>
            <span className={s.ready ? "text-success" : "text-muted-foreground"}>{i >= room.max ? "Watching" : s.ready ? "Ready" : "Not ready"}</span>
          </li>
        ))}
      </ul>
      {isHost ? (
        <button type="button" className={btn} disabled={busy || !can.ok} onClick={() => run(async () => { await startRound(room, seats); await state.refresh(); })}>
          {can.ok ? "Start the game" : can.why}
        </button>
      ) : watching ? (
        <p className="text-sm text-muted-foreground">The room is full. You can watch.</p>
      ) : (
        <button type="button" className={btn} disabled={busy || !mine} onClick={() => run(async () => { await setReady(room, mine!.name, !mine!.ready); await state.refresh(); })}>
          {mine?.ready ? "Not ready" : "I'm ready"}
        </button>
      )}
      <button type="button" className="text-sm underline" onClick={() => void leave()}>
        {isHost ? "Close room" : "Leave room"}
      </button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
`;

/** The room's files, the same in every multiplayer template. */
export const ROOM_FILES: Record<string, string> = {
  "src/room/room.ts": ROOM_TS,
  "src/room/useRoom.ts": USE_ROOM_TS,
  "src/room/Lobby.tsx": LOBBY_TSX,
};

/** What every multiplayer template's brief says about the room. */
export const ROOM_BRIEF = `The room (src/room/) is GoodBuild's tested lobby: wallet sign-in, a room with a 5-letter code, join by code, ready, the host starts, rematch. Keep it and its three collections in src/lib/dataRules.json (rooms, seats, moves) as they are. There is no live connection: every screen asks for news every 3 seconds, so never promise real-time action. Whose turn it is and who won are worked out from the moves, the same way on every screen (see the multiplayer guide). Moves come from players' own devices: a result is between friends, never proof for money or prizes. Inside MiniPay rooms aren't offered (no sign-in signature), only Play the computer. Keep "Play the computer" as the first button on the start screen: it's what people without friends online play, and what GoodBuild's check plays.`;
