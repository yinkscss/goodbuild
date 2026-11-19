import type { GameTemplate } from "./index";
import { ROOM_BRIEF, ROOM_FILES, ROOM_RULES } from "./room";
import { appFor } from "./shared";

/**
 * Crew and saboteur (D142, PR 7 of D139): an original social deduction party game for 4 to 10 on the room
 * and the dealer. The crew fix the station; hidden saboteurs knock people out and break the oxygen. A
 * knock-out calls a meeting and a vote. Phases are worked out from the records, the same on every screen.
 * Never another game's name, characters or art.
 */

/** Its own collections, beside the room's: the dealt roles, and actions whose author nobody sees. */
export const SABOTEUR_RULES = {
  roles: "dealt",
  events: {
    create: "signed-in",
    read: ["writer"],
    update: [],
    delete: [],
    public: ["code", "round", "kind", "target"],
    fields: { code: "string", round: "number", kind: "string", target: "string" },
  },
} as const;

const RULES = `// The rules, with no screen: who is out, what phase it is and who won, worked out from the records.
// Everyone runs the same code on the same records, so every screen agrees.

export const GAME_NAME = "Deep Station";
export const BEST_KEY = "deep-station";
export const SABOTEUR = "saboteur";
export const CREW = "crew";
export const TASKS = ["Reset the pump", "Seal the hatch", "Tune the sonar", "Clear the filter", "Patch the cable"];

export interface Timing {
  /** Tasks each crew member does. All of them done wins it for the crew. */
  tasksEach: number;
  /** Seconds a meeting lasts, from the knock-out to the end of the vote. */
  meeting: number;
  /** Seconds between two knock-outs, and between two sabotages. */
  knockCooldown: number;
  sabotageCooldown: number;
  /** Seconds the crew has to fix the oxygen. */
  crisis: number;
  /** Seconds to wait for someone voted out to show their role, before they count as crew. */
  revealWait: number;
}

export const ONLINE: Timing = { tasksEach: 4, meeting: 45, knockCooldown: 30, sabotageCooldown: 40, crisis: 30, revealWait: 10 };
export const PRACTICE: Timing = { tasksEach: 3, meeting: 10, knockCooldown: 12, sabotageCooldown: 25, crisis: 15, revealWait: 1 };

/** How many saboteurs: one for 4 to 6 players, two for 7 to 10. Everyone knows this; nobody knows who. */
export const saboteurCount = (players: number) => (players >= 7 ? 2 : 1);

/** The roles to deal, one each. */
export function rolesDeck(players: number): string[] {
  const s = saboteurCount(players);
  return Array.from({ length: players }, (_, i) => (i < s ? SABOTEUR : CREW));
}

/** Anonymous actions (nobody sees who sent them): a task done, a knock-out, a sabotage, a fix. */
export interface Act {
  kind: string;
  target: string;
  at: number;
}
/** Signed actions: a vote, a role shown by someone who is out. */
export interface Signed {
  wallet: string;
  kind: string;
  target: string;
  at: number;
}

export interface Meeting {
  victim: string;
  endsAt: number;
  votes: Record<string, string>;
}

export interface Station {
  phase: "tasks" | "meeting" | "over";
  alive: string[];
  knocked: string[];
  ejected: string[];
  /** Roles shown so far: by those out, and by everyone once it's over. */
  shown: Record<string, string>;
  tasksDone: number;
  tasksNeeded: number;
  meeting: Meeting | null;
  /** The last meeting's result, for a moment after it. */
  lastVote: { out: string | null; at: number } | null;
  crisisEndsAt: number | null;
  nextKnockAt: number;
  nextSabotageAt: number;
  winner: "crew" | "saboteurs" | null;
  why: string;
}

/** The station after these records, at time now (milliseconds). */
export function station(players: string[], acts: Act[], signed: Signed[], start: number, now: number, t: Timing): Station {
  const s: Station = {
    phase: "tasks", alive: [...players], knocked: [], ejected: [], shown: {}, tasksDone: 0,
    tasksNeeded: t.tasksEach * (players.length - saboteurCount(players.length)), meeting: null, lastVote: null,
    crisisEndsAt: null, nextKnockAt: start + t.knockCooldown * 1000, nextSabotageAt: start + t.sabotageCooldown * 1000, winner: null, why: "",
  };
  const outAt: Record<string, number> = {};
  const win = (who: "crew" | "saboteurs", why: string) => {
    if (s.winner) return;
    s.winner = who;
    s.why = why;
    s.phase = "over";
  };
  const judge = (at: number) => {
    if (s.winner) return;
    if (s.tasksDone >= s.tasksNeeded) return win("crew", "Every task is done");
    const total = saboteurCount(players.length);
    const known = s.ejected.filter((p) => s.shown[p] === SABOTEUR).length;
    const waiting = s.ejected.some((p) => s.shown[p] === undefined && at < outAt[p] + t.revealWait * 1000);
    if (known >= total) return win("crew", "Every saboteur was voted out");
    if (waiting) return;
    const left = total - known;
    if (s.alive.length - left <= left) win("saboteurs", "The saboteurs outnumber the crew");
  };
  const closeMeeting = (at: number) => {
    const m = s.meeting!;
    s.meeting = null;
    s.phase = "tasks";
    const count: Record<string, number> = {};
    for (const v of Object.values(m.votes)) count[v] = (count[v] ?? 0) + 1;
    const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const out = top && top[0] !== "skip" && (ranked.length === 1 || ranked[1][1] < top[1]) && s.alive.includes(top[0]) ? top[0] : null;
    if (out) {
      s.alive = s.alive.filter((p) => p !== out);
      s.ejected.push(out);
      outAt[out] = at;
    }
    s.lastVote = { out, at };
    s.nextKnockAt = Math.max(s.nextKnockAt, at + t.knockCooldown * 1000);
    judge(at);
  };
  // Timers that ran out before this moment: a meeting's end, the oxygen running out.
  const tick = (at: number) => {
    if (s.meeting && at >= s.meeting.endsAt) closeMeeting(s.meeting.endsAt);
    if (!s.winner && s.crisisEndsAt !== null && at >= s.crisisEndsAt) win("saboteurs", "The oxygen ran out");
    judge(at);
  };
  const all = [...acts.map((a) => ({ ...a, wallet: "" })), ...signed].sort((a, b) => a.at - b.at);
  for (const r of all) {
    tick(r.at);
    if (r.kind === "reveal") {
      if (r.wallet && !players.includes(r.wallet)) continue;
      if (r.wallet && (s.knocked.includes(r.wallet) || s.ejected.includes(r.wallet) || s.winner)) s.shown[r.wallet] = r.target === SABOTEUR ? SABOTEUR : CREW;
      judge(r.at);
      continue;
    }
    if (s.winner) continue;
    if (r.kind === "task" && !s.meeting) s.tasksDone = Math.min(s.tasksNeeded, s.tasksDone + 1);
    else if (r.kind === "knock" && !s.meeting && r.at >= s.nextKnockAt && s.alive.includes(r.target)) {
      s.alive = s.alive.filter((p) => p !== r.target);
      s.knocked.push(r.target);
      s.shown[r.target] = CREW;
      s.crisisEndsAt = null;
      s.nextKnockAt = r.at + t.knockCooldown * 1000;
      s.meeting = { victim: r.target, endsAt: r.at + t.meeting * 1000, votes: {} };
      s.phase = "meeting";
    } else if (r.kind === "sabotage" && !s.meeting && s.crisisEndsAt === null && r.at >= s.nextSabotageAt) {
      s.crisisEndsAt = r.at + t.crisis * 1000;
      s.nextSabotageAt = r.at + t.sabotageCooldown * 1000;
    } else if (r.kind === "fix" && s.crisisEndsAt !== null) s.crisisEndsAt = null;
    else if (r.kind === "vote" && s.meeting && s.alive.includes(r.wallet) && !(r.wallet in s.meeting.votes)) {
      s.meeting.votes[r.wallet] = r.target === "skip" || s.alive.includes(r.target) ? r.target : "skip";
      // Everyone still in has voted: the meeting ends now.
      if (s.alive.every((p) => p in s.meeting!.votes)) closeMeeting(r.at);
    }
    judge(r.at);
  }
  tick(now);
  return s;
}
`;

const TASK_PANEL = `import { useState } from "react";
import { moved } from "../game/probe";
import { TASKS } from "./rules";

/** A task: tap the numbered tiles in order. Done calls onDone once. */
function Task({ name, onDone, onStep }: { name: string; onDone: () => void; onStep: () => void }) {
  const [order] = useState(() => [1, 2, 3].sort(() => Math.random() - 0.5));
  const [next, setNext] = useState(1);
  const tap = (n: number) => {
    moved();
    if (n !== next) return setNext(1);
    onStep();
    if (n === 3) {
      setNext(4);
      onDone();
    } else setNext(n + 1);
  };
  if (next > 3) return <p className="rounded-lg bg-success/10 px-3 py-2 text-sm">{name}: done</p>;
  return (
    <div className="rounded-lg bg-background p-2">
      <p className="mb-1 text-sm font-medium">{name}: tap 1, 2, 3</p>
      <div className="grid grid-cols-3 gap-2">
        {order.map((n) => (
          <button key={n} type="button" onClick={() => tap(n)} className={"rounded-lg px-3 py-3 text-lg font-semibold " + (n < next ? "bg-primary text-primary-foreground" : "bg-muted")}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}

/** This player's tasks. A saboteur gets the same list, which does nothing, so they can look busy. */
export function TaskPanel({ count, fake, onTask, onStep }: { count: number; fake: boolean; onTask: () => void; onStep: () => void }) {
  const [done, setDone] = useState(0);
  const names = TASKS.slice(0, count);
  return (
    <div className="space-y-2">
      <p className="text-xs uppercase tracking-widest text-muted-foreground">{fake ? "Look busy (these do nothing)" : "Your tasks " + done + "/" + count}</p>
      {names.map((name) => (
        <Task
          key={name}
          name={name}
          onStep={onStep}
          onDone={() => {
            setDone((d) => d + 1);
            if (!fake) onTask();
          }}
        />
      ))}
    </div>
  );
}
`;

const STATION_VIEW = `import { SABOTEUR, type Station } from "./rules";
import { TaskPanel } from "./TaskPanel";

export interface Who {
  wallet: string;
  name: string;
}

/** One screen of the station for one player: tasks, a crisis, a meeting, the end. Online and practice share it. */
export function StationView({ s, me, role, people, now, tasksEach, act }: {
  s: Station;
  me: string;
  role: string | null;
  people: Who[];
  now: number;
  tasksEach: number;
  act: (kind: string, target?: string) => void;
}) {
  const name = (w: string) => people.find((p) => p.wallet === w)?.name ?? "Someone";
  const alive = s.alive.includes(me);
  const saboteur = role === SABOTEUR;
  const secs = (at: number) => Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className={"rounded-full px-3 py-1 font-semibold " + (saboteur ? "bg-danger/15 text-danger" : "bg-primary/10 text-primary")}>{role === null ? "Getting your role..." : saboteur ? "You are a saboteur" : "You are crew"}</span>
        <span className="tabular-nums">Tasks {s.tasksDone}/{s.tasksNeeded}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-success" style={{ width: (s.tasksDone / Math.max(1, s.tasksNeeded)) * 100 + "%" }} />
      </div>
      {s.phase === "over" && (
        <div className="space-y-2 rounded-xl bg-muted p-3">
          <p className="text-xl font-semibold">{s.winner === "crew" ? "The crew wins" : "The saboteurs win"}</p>
          <p className="text-sm">{s.why}.</p>
          <ul className="text-sm">
            {people.map((p) => (
              <li key={p.wallet}>{p.name}: {s.shown[p.wallet] === SABOTEUR ? "saboteur" : s.shown[p.wallet] ? "crew" : "..."}</li>
            ))}
          </ul>
        </div>
      )}
      {s.phase !== "over" && s.lastVote && now - s.lastVote.at < 5000 && !s.meeting && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">{s.lastVote.out ? name(s.lastVote.out) + " was voted out." : "Nobody was voted out."}</p>
      )}
      {s.phase === "meeting" && s.meeting && (
        <div className="space-y-2 rounded-xl bg-warning/10 p-3">
          <p className="font-semibold">Meeting: {name(s.meeting.victim)} was knocked out</p>
          <p className="text-sm">Talk it over, then vote. {secs(s.meeting.endsAt)}s left.</p>
          <div data-game-area className="grid grid-cols-2 gap-2">
            {[...s.alive, "skip"].map((w) => (
              <button key={w} type="button" disabled={!alive || me in s.meeting!.votes} onClick={() => act("vote", w)} className="rounded-lg bg-background px-3 py-2 text-sm font-medium disabled:opacity-50">
                {w === "skip" ? "Skip vote" : "Vote " + name(w)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">{Object.keys(s.meeting.votes).length} of {s.alive.length} voted</p>
        </div>
      )}
      {s.phase === "tasks" && (
        <>
          {s.crisisEndsAt !== null && (
            <div className="flex items-center justify-between rounded-xl bg-danger/15 p-3">
              <p className="font-semibold text-danger">Oxygen failing: {secs(s.crisisEndsAt)}s</p>
              {alive && !saboteur && (
                <button type="button" onClick={() => act("fix")} className="rounded-lg bg-danger px-4 py-2 font-semibold text-white">
                  Fix it
                </button>
              )}
            </div>
          )}
          {!alive && <p className="text-sm text-muted-foreground">You're out. Watch how it ends.</p>}
          {alive && role !== null && (
            <div data-game-area className="space-y-3">
              {saboteur && (
                <div className="space-y-2 rounded-xl bg-danger/10 p-3">
                  <p className="text-sm font-medium">{now < s.nextKnockAt ? "Knock out again in " + secs(s.nextKnockAt) + "s" : "Knock someone out"}</p>
                  <div className="grid grid-cols-2 gap-2">
                    {s.alive.filter((w) => w !== me).map((w) => (
                      <button key={w} type="button" disabled={now < s.nextKnockAt} onClick={() => act("knock", w)} className="rounded-lg bg-background px-3 py-2 text-sm disabled:opacity-50">
                        {name(w)}
                      </button>
                    ))}
                  </div>
                  <button type="button" disabled={now < s.nextSabotageAt || s.crisisEndsAt !== null} onClick={() => act("sabotage")} className="w-full rounded-lg bg-danger px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
                    {now < s.nextSabotageAt ? "Sabotage in " + secs(s.nextSabotageAt) + "s" : "Sabotage the oxygen"}
                  </button>
                </div>
              )}
              <TaskPanel count={tasksEach} fake={saboteur} onTask={() => act("task")} onStep={() => act("step")} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
`;

const ONLINE = `import { useEffect, useRef, useState } from "react";
import { collection, deal, dealInfo, type DealtHand } from "../lib/db";
import { useCollection } from "../lib/useDb";
import { LIVE_MS } from "../room/room";
import type { LiveRoom } from "../room/Lobby";
import { ONLINE as T, rolesDeck, station, type Act, type Signed } from "./rules";
import { StationView } from "./StationView";

/** A signed move: the deal's id (from the host), a vote, or a role shown by someone who is out. */
export interface Move {
  kind: string;
  target: string;
}
interface EventValue {
  code: string;
  round: number;
  kind: string;
  target: string;
}

/** A round in a room. The host deals the roles through GoodBuild's dealer; each player reads only their own. */
export function OnlineStation({ live }: { live: LiveRoom<Move> }) {
  const { room, me, players, moves } = live;
  const [now, setNow] = useState(() => Date.now());
  const [role, setRole] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dealing = useRef(false);
  const shown = useRef(false);
  const dealMove = moves.find((m) => m.n === 0 && m.wallet === room.host && m.data.kind === "deal");
  const dealId = dealMove?.data.target ?? null;
  const events = useCollection<EventValue>("events", { where: [["code", "eq", room.code], ["round", "eq", room.round]], orderBy: "createdAt", dir: "asc", limit: 100, liveEvery: LIVE_MS, wallet: me });
  const hands = useCollection<DealtHand>("roles", { enabled: Boolean(dealId), where: [["deal", "eq", dealId ?? ""]], wallet: me });

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // The host deals once per round, and tells everyone the deal's id.
  useEffect(() => {
    if (me !== room.host || dealId || dealing.current) return;
    dealing.current = true;
    void (async () => {
      try {
        const receipt = await deal("roles", { room: room.code + ":" + room.round, players: room.players, deck: rolesDeck(room.players.length), hand: 1 });
        await live.send(0, { kind: "deal", target: receipt.id });
      } catch {
        dealing.current = false;
        setError("The roles couldn't be dealt. Check your connection.");
      }
    })();
  }, [me, room, dealId, live]);

  // Your role, once dealt, and only from a deal the room's host made.
  useEffect(() => {
    const mine = hands.records.find((r) => r.value?.deal === dealId);
    if (!dealId || !mine || role) return;
    void dealInfo("roles", dealId)
      .then((d) => {
        if (d.host === room.host) setRole(mine.value.items[0] ?? null);
      })
      .catch(() => undefined);
  }, [hands.records, dealId, role, room.host]);

  const start = dealMove?.at ?? room.startedAt;
  const acts: Act[] = events.records.map((r) => ({ kind: String(r.value.kind), target: String(r.value.target), at: Date.parse(r.createdAt) }));
  const signed: Signed[] = moves.filter((m) => m.n > 0).map((m) => ({ wallet: m.wallet, kind: m.data.kind, target: m.data.target, at: m.at }));
  const s = station(room.players, dealId ? acts : [], signed, start, now, T);

  // Out, or the game is over: show your role so everyone can count the saboteurs.
  useEffect(() => {
    const out = !s.alive.includes(me) || s.phase === "over";
    if (!role || !out || shown.current || signed.some((m) => m.wallet === me && m.kind === "reveal")) return;
    shown.current = true;
    void live.send(1 + signed.length, { kind: "reveal", target: role }).catch(() => (shown.current = false));
  });

  const act = (kind: string, target = "") => {
    if (kind === "step") return;
    setError(null);
    const write = kind === "vote" ? live.send(1 + signed.length, { kind, target }) : collection<EventValue>("events").add({ code: room.code, round: room.round, kind, target }).then(() => events.refresh());
    void write.catch(() => setError("That didn't send. Check your connection."));
  };

  if (!dealId) return <p className="text-sm text-muted-foreground">{me === room.host ? "Dealing the roles..." : "The host is dealing the roles..."}</p>;
  return (
    <div className="space-y-3">
      <StationView s={s} me={me} role={role} people={players} now={now} tasksEach={T.tasksEach} act={act} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {s.phase === "over" &&
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

const GAME = `import { useEffect, useRef, useState } from "react";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { buzz } from "../game/haptics";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { RoomLobby } from "../room/Lobby";
import { OnlineStation, type Move } from "./Online";
import { BEST_KEY, CREW, GAME_NAME, PRACTICE as T, SABOTEUR, rolesDeck, station, type Act, type Signed } from "./rules";
import { StationView } from "./StationView";

// A party game played with buttons: tasks, votes, knock-outs. Keep this in step with the game.
declareGame({ style: "turns", controls: ["buttons"], npcs: ["computer"] });

const ROOM = { game: "deep-station", min: 4, max: 10 };
const YOU = "you";
const BOTS = [
  { wallet: "bot1", name: "Ife" },
  { wallet: "bot2", name: "Musa" },
  { wallet: "bot3", name: "Ada" },
  { wallet: "bot4", name: "Kofi" },
];
const PEOPLE = [{ wallet: YOU, name: "You" }, ...BOTS];

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [roles, setRoles] = useState<Record<string, string>>({});
  const [acts, setActs] = useState<Act[]>([]);
  const [signed, setSigned] = useState<Signed[]>([]);
  const [start, setStart] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [inRoom, setInRoom] = useState(false);
  const scoreRef = useRef(0);
  const ended = useRef(false);

  const players = PEOPLE.map((p) => p.wallet);
  const s = station(players, acts, signed, start, now, T);
  const mine = roles[YOU] ?? null;

  const begin = () => {
    const deck = rolesDeck(players.length).sort(() => Math.random() - 0.5);
    setRoles(Object.fromEntries(players.map((p, i) => [p, deck[i]])));
    setActs([]);
    setSigned([]);
    const t = Date.now();
    setStart(t);
    setNow(t);
    scoreRef.current = 0;
    setScore(0);
    ended.current = false;
    setScreen("playing");
    round(true);
    probe(0);
    spawned("computer");
    sfx.tap();
  };

  // The clock, and the computer players: crew do tasks and fix, a saboteur knocks out and sabotages, all vote.
  useEffect(() => {
    if (screen !== "playing") return;
    const timer = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const cur = station(players, acts, signed, start, t, T);
      if (cur.phase === "over") return;
      const add = (kind: string, target = "") => setActs((a) => [...a, { kind, target, at: t }]);
      for (const b of BOTS) {
        if (!cur.alive.includes(b.wallet)) continue;
        const bad = roles[b.wallet] === SABOTEUR;
        if (cur.meeting) {
          if (!(b.wallet in cur.meeting.votes) && Math.random() < 0.3) {
            const suspects = cur.alive.filter((w) => w !== b.wallet && (bad ? roles[w] !== SABOTEUR : true));
            const sab = cur.alive.find((w) => roles[w] === SABOTEUR && w !== b.wallet);
            const pick = !bad && sab && Math.random() < 0.5 ? sab : suspects[Math.floor(Math.random() * suspects.length)] ?? "skip";
            setSigned((v) => [...v, { wallet: b.wallet, kind: "vote", target: pick, at: t }]);
          }
        } else if (bad) {
          const crew = cur.alive.filter((w) => roles[w] !== SABOTEUR);
          if (t >= cur.nextKnockAt && Math.random() < 0.25 && crew.length) add("knock", crew[Math.floor(Math.random() * crew.length)]);
          else if (t >= cur.nextSabotageAt && cur.crisisEndsAt === null && Math.random() < 0.15) add("sabotage");
        } else if (cur.crisisEndsAt !== null && Math.random() < 0.2) add("fix");
        else if (Math.random() < 0.18) add("task");
      }
    }, 1000);
    return () => window.clearInterval(timer);
  });

  // The end of a round.
  useEffect(() => {
    if (screen !== "playing" || s.phase !== "over" || ended.current) return;
    ended.current = true;
    const won = (s.winner === "crew") === (mine === CREW);
    if (won) scoreRef.current += 100;
    setScore(scoreRef.current);
    probe(scoreRef.current);
    round(false);
    if (saveBest(scoreRef.current, BEST_KEY)) setBest(scoreRef.current);
    if (won) sfx.win();
    else sfx.hit();
    setScreen("over");
  });

  const act = (kind: string, target = "") => {
    const t = Date.now();
    if (kind === "step") {
      // A right tile in a task: the tile already counted as a move.
      scoreRef.current += 2;
      setScore(scoreRef.current);
      probe(scoreRef.current);
      return;
    }
    moved();
    buzz("collect");
    if (kind === "vote") setSigned((v) => [...v, { wallet: YOU, kind, target, at: t }]);
    else setActs((a) => [...a, { kind, target, at: t }]);
    if (kind === "task" || kind === "knock" || kind === "fix") {
      scoreRef.current += kind === "task" ? 10 : 20;
      setScore(scoreRef.current);
      probe(scoreRef.current);
      sfx.coin();
    }
  };

  // In practice everyone's role shows at the end.
  const shownAll = s.phase === "over" ? { ...s, shown: roles } : s;

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        {screen === "start" && (
          <div className="space-y-5">
            <div className="space-y-2 text-center">
              <h2 className="text-2xl font-semibold">{GAME_NAME}</h2>
              <p className="text-muted-foreground">Keep the station running. One of you is a saboteur. Do your tasks, fix the oxygen, and vote out whoever you suspect.</p>
              {best > 0 && <p className="text-sm">Your best: {best}</p>}
            </div>
            {!inRoom && (
              <button type="button" onClick={begin} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
                Play the computer
              </button>
            )}
            <div className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">With friends (4 to 10)</h3>
              <RoomLobby<Move> config={ROOM} onRoom={setInRoom}>
                {(live) => <OnlineStation live={live} />}
              </RoomLobby>
            </div>
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-3">
            <p className="text-2xl font-semibold tabular-nums">{score}</p>
            <StationView s={shownAll} me={YOU} role={mine} people={PEOPLE} now={now} tasksEach={T.tasksEach} act={act} />
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Result", value: s.winner === "crew" ? "Crew won" : "Saboteurs won" }]} onAgain={begin} shareText={"I scored " + score + " in " + GAME_NAME} />
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
    </div>
  );
}
`;

export const saboteurParty: GameTemplate = {
  id: "saboteur-party",
  name: "Crew and saboteur",
  dims: "2d",
  style: "turns",
  fits: "social deduction party games for 4 to 10 in a room: a crew with tasks, hidden saboteurs or traitors who knock people out and sabotage, meetings and voting someone out (any setting: a station, a ship, a village, an office)",
  kits: ["game-2d"],
  files: {
    ...ROOM_FILES,
    "src/App.tsx": appFor("./play/rules", "GAME_NAME"),
    "src/play/rules.ts": RULES,
    "src/play/TaskPanel.tsx": TASK_PANEL,
    "src/play/StationView.tsx": STATION_VIEW,
    "src/play/Online.tsx": ONLINE,
    "src/play/Game.tsx": GAME,
  },
  rules: { ...ROOM_RULES, ...SABOTEUR_RULES },
  multiplayer: true,
  title: { from: "./play/rules", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Crew and saboteur template, a working, tested party game for 4 to 10: src/play/rules.ts (the name, the timings, who is out, the phases and who won, worked out from the records), src/play/StationView.tsx (one player's screen), src/play/TaskPanel.tsx (the tasks), src/play/Online.tsx (a round in a room, with the roles from GoodBuild's dealer), src/play/Game.tsx (the start screen and a round against computer players) and src/room/ (the room). Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY, and ROOM.game in Game.tsx), give it the plan's setting and look (the station can be a ship, a village, a farm), rename the tasks and the computer players, and change the timings the plan asks for in rules.ts. Keep it original: never another game's name, characters or art.
- Roles come only from GoodBuild's dealer ("roles": "dealt"), never from a player's device. Knock-outs, sabotage, tasks and fixes go in "events", whose author nobody sees; votes and shown roles are signed moves. Keep those rules in src/lib/dataRules.json.
- ${ROOM_BRIEF}
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every action, probe(score) when the score changes, the actions inside <div data-game-area>, GameOver with Play again, free play with no wallet.`,
};
