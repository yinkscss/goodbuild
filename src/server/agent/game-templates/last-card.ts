import { CARD_FILES } from "./cards";
import type { GameTemplate } from "./index";
import { ROOM_BRIEF, ROOM_FILES, ROOM_RULES } from "./room";
import { appFor } from "./shared";

/**
 * Last card out (D143, PR 8 of D139): an original shedding game in the crazy-eights style for 2 to 6. Match
 * the top card's suit or rank, an 8 changes the suit, can't go: draw one. First with no cards wins. Hands
 * come from GoodBuild's dealer (D141), so nobody sees anyone else's. For points only, never money.
 */

const INFO = `export const GAME_NAME = "Last Card Out";
export const BEST_KEY = "last-card-out";
`;

const RULES = `// The rules, with no screen. Every screen replays the same public moves the same way.
import { rankOf, suitOf, type Card, type Suit } from "../cards/cards";

/** Cards each: 7 for two players, 5 for more. */
export const handSize = (players: number) => (players === 2 ? 7 : 5);
/** The card that changes the suit. */
export const WILD = "8";

/**
 * A move. "start": the host turns the first card (n = 0, with the deal's id). "play": a card from your
 * hand, with the suit you call when it's an 8. "draw": you took a card and your turn ends. "pass": the
 * deck is empty and you can't go.
 */
export interface Play {
  kind: "start" | "play" | "draw" | "pass";
  card?: Card;
  suit?: Suit;
  deal?: string;
}

export function canPlay(card: Card, top: Card, called: Suit): boolean {
  return rankOf(card) === WILD || suitOf(card) === called || rankOf(card) === rankOf(top);
}

export interface Pile {
  top: Card | null;
  called: Suit | null;
  /** The next move's number; its player is players[(turn - 1) % players.length]. */
  turn: number;
  /** Cards each player holds, from the public moves. */
  counts: number[];
  /** Cards each player has played, so a hand can take them away. */
  played: Card[][];
  winner: number | null;
  deal: string | null;
}

/** The game after these moves. A move out of turn, a repeat of a turn already taken, or a card that can't go is left out. */
export function replay(moves: Array<{ wallet: string; n: number; data: Play }>, players: string[], host: string): Pile {
  const p: Pile = { top: null, called: null, turn: 1, counts: players.map(() => handSize(players.length)), played: players.map(() => []), winner: null, deal: null };
  const start = moves.find((m) => m.n === 0 && m.wallet === host && m.data?.kind === "start" && m.data.card);
  if (!start) return p;
  p.top = start.data.card!;
  p.called = suitOf(p.top);
  p.deal = start.data.deal ?? null;
  const hostSeat = players.indexOf(host);
  if (hostSeat >= 0) p.played[hostSeat].push(p.top);
  let passes = 0;
  for (const m of moves) {
    if (p.winner !== null || m.n !== p.turn) continue;
    const seat = (p.turn - 1) % players.length;
    if (m.wallet !== players[seat]) continue;
    const d = m.data;
    if (d.kind === "play" && d.card && canPlay(d.card, p.top!, p.called!) && !p.played.some((cards) => cards.includes(d.card!))) {
      p.top = d.card;
      p.called = rankOf(d.card) === WILD && d.suit ? d.suit : suitOf(d.card);
      p.played[seat].push(d.card);
      p.counts[seat]--;
      if (p.counts[seat] <= 0) p.winner = seat;
      passes = 0;
    } else if (d.kind === "draw") {
      p.counts[seat]++;
      passes = 0;
    } else if (d.kind === "pass") {
      // The deck is empty and nobody can go: fewest cards wins (the earlier seat on a tie).
      if (++passes >= players.length) p.winner = p.counts.indexOf(Math.min(...p.counts));
    } else continue;
    p.turn++;
  }
  return p;
}
`;

const TABLE = `import { CardFace } from "../cards/CardFace";
import { SUITS, SUIT_SIGN, type Card, type Suit } from "../cards/cards";
import { WILD, canPlay, type Pile } from "./rules";
import { rankOf } from "../cards/cards";
import { useState } from "react";

/** One player's view: the others' counts, the pile, your hand. Online and practice share it. */
export function CardTable({ pile, names, me, hand, busy, onPlay, onDraw }: {
  pile: Pile;
  names: string[];
  me: number;
  hand: Card[];
  busy: boolean;
  onPlay: (card: Card, suit?: Suit) => void;
  onDraw: () => void;
}) {
  const [wild, setWild] = useState<Card | null>(null);
  const seat = (pile.turn - 1) % names.length;
  const mine = pile.winner === null && seat === me && !busy && pile.top !== null;
  return (
    <div className="space-y-3">
      <ul className="flex flex-wrap gap-2 text-sm">
        {names.map((n, i) => (
          <li key={i} className={"rounded-full px-3 py-1 " + (i === seat && pile.winner === null ? "bg-primary text-primary-foreground" : "bg-muted")}>
            {i === me ? "You" : n}: {pile.counts[i]}
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-center gap-4">
        {pile.top ? <CardFace card={pile.top} size={88} /> : <CardFace down size={88} />}
        {pile.called && pile.top && rankOf(pile.top) === WILD && <p className="text-lg font-semibold">Suit: {SUIT_SIGN[pile.called]}</p>}
      </div>
      <p className="text-center text-sm" aria-live="polite">
        {pile.winner !== null ? (pile.winner === me ? "You're out first: you win!" : names[pile.winner] + " wins") : mine ? "Your turn: play a card or draw" : "Waiting for " + names[seat] + "..."}
      </p>
      <div data-game-area className="space-y-2">
        {wild ? (
          <div className="grid grid-cols-4 gap-2">
            {SUITS.map((s) => (
              <button key={s} type="button" aria-label={"Call " + s} onClick={() => { onPlay(wild, s); setWild(null); }} className="rounded-lg bg-muted py-3 text-2xl">
                {SUIT_SIGN[s]}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap justify-center gap-1">
              {hand.map((card) => {
                const ok = mine && canPlay(card, pile.top!, pile.called!);
                return (
                  <button key={card} type="button" disabled={!ok} onClick={() => (rankOf(card) === WILD ? setWild(card) : onPlay(card))} className={"rounded-lg transition-transform " + (ok ? "-translate-y-1" : "opacity-60")}>
                    <CardFace card={card} size={52} />
                  </button>
                );
              })}
            </div>
            <button type="button" disabled={!mine} onClick={onDraw} className="w-full rounded-xl bg-background py-3 font-medium shadow-sm disabled:opacity-50">
              Draw a card
            </button>
          </>
        )}
      </div>
    </div>
  );
}
`;

const ONLINE = `import { useEffect, useRef, useState } from "react";
import { fullDeck, type Card, type Suit } from "../cards/cards";
import { deal, dealInfo, draw, DbError, type DealtHand } from "../lib/db";
import { useCollection } from "../lib/useDb";
import type { LiveRoom } from "../room/Lobby";
import { CardTable } from "./CardTable";
import { handSize, replay, type Play } from "./rules";

/** A round in a room. The host deals through GoodBuild's dealer; each hand is read by its player alone. */
export function OnlineCards({ live }: { live: LiveRoom<Play> }) {
  const { room, me, players, moves } = live;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trusted, setTrusted] = useState(false);
  const dealing = useRef(false);
  const pile = replay(moves, room.players, room.host);
  const hands = useCollection<DealtHand>("hands", { enabled: Boolean(pile.deal), where: [["deal", "eq", pile.deal ?? ""]], limit: 100, wallet: me });
  const seat = room.players.indexOf(me);

  // The host deals once per round, turns the first card, and tells everyone the deal's id.
  useEffect(() => {
    if (me !== room.host || pile.deal || dealing.current) return;
    dealing.current = true;
    void (async () => {
      try {
        const d = await deal("hands", { room: room.code + ":" + room.round, players: room.players, deck: fullDeck(), hand: handSize(room.players.length) });
        const first = await draw("hands", d.id, 1);
        await live.send(0, { kind: "start", card: first.items[0], deal: d.id });
      } catch {
        dealing.current = false;
        setError("The cards couldn't be dealt. Check your connection.");
      }
    })();
  }, [me, room, pile.deal, live]);

  // Only a deal the room's host made counts.
  useEffect(() => {
    if (!pile.deal || trusted) return;
    void dealInfo("hands", pile.deal).then((d) => setTrusted(d.host === room.host)).catch(() => undefined);
  }, [pile.deal, trusted, room.host]);

  const mine = seat >= 0 ? pile.played[seat] : [];
  const hand: Card[] = trusted ? hands.records.flatMap((r) => r.value?.items ?? []).filter((c) => !mine.includes(c)) : [];

  const send = async (play: Play) => {
    setBusy(true);
    setError(null);
    try {
      if (play.kind === "draw") {
        try {
          await draw("hands", pile.deal!, 1);
          await hands.refresh();
        } catch (e) {
          // The deck is empty: the turn passes.
          if (e instanceof DbError && e.status === 409) play = { kind: "pass" };
          else throw e;
        }
      }
      await live.send(pile.turn, play);
    } catch {
      setError("That didn't send. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!pile.top) return <p className="text-sm text-muted-foreground">{me === room.host ? "Dealing..." : "The host is dealing..."}</p>;
  return (
    <div className="space-y-3">
      <CardTable pile={pile} names={room.players.map((w) => players.find((p) => p.wallet === w)?.name ?? "Player")} me={seat} hand={hand} busy={busy || !trusted} onPlay={(card: Card, suit?: Suit) => void send({ kind: "play", card, suit })} onDraw={() => void send({ kind: "draw" })} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {pile.winner !== null &&
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
import { fullDeck, rankOf, shuffle, type Card, type Suit, SUITS, suitOf } from "../cards/cards";
import { GameMenu } from "../game/GameMenu";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { buzz } from "../game/haptics";
import { declareGame, moved, probe, round, spawned } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { RoomLobby } from "../room/Lobby";
import { CardTable } from "./CardTable";
import { BEST_KEY, GAME_NAME } from "./info";
import { OnlineCards } from "./Online";
import { WILD, canPlay, handSize, replay, type Play } from "./rules";

// A turn-based card game played with buttons, against computer players or friends in a room. Keep this in step with the game.
declareGame({ style: "turns", controls: ["buttons"], npcs: ["computer"] });

const ROOM = { game: "last-card-out", min: 2, max: 6 };
const SEATS = ["you", "bot1", "bot2"];
const NAMES = ["You", "Tomi", "Nia"];

type Screen = "start" | "playing" | "over";
type Move = { wallet: string; n: number; data: Play };

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [moves, setMoves] = useState<Move[]>([]);
  const [hands, setHands] = useState<Card[][]>([[], [], []]);
  const [stock, setStock] = useState<Card[]>([]);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [inRoom, setInRoom] = useState(false);
  const scoreRef = useRef(0);
  const ended = useRef(false);

  const pile = replay(moves, SEATS, "you");
  const seat = (pile.turn - 1) % SEATS.length;

  const begin = () => {
    const deck = shuffle(fullDeck());
    const size = handSize(SEATS.length);
    setHands(SEATS.map((_, i) => deck.slice(i * size, (i + 1) * size)));
    const first = deck[SEATS.length * size];
    setStock(deck.slice(SEATS.length * size + 1));
    setMoves([{ wallet: "you", n: 0, data: { kind: "start", card: first } }]);
    scoreRef.current = 0;
    setScore(0);
    ended.current = false;
    setScreen("playing");
    round(true);
    probe(0);
    spawned("computer");
    sfx.tap();
  };

  /** A seat plays a card or draws, as one move, the same way the room does. */
  const take = (who: number, play: Play) => {
    if (play.kind === "draw") {
      if (!stock.length) play = { kind: "pass" };
      else {
        setHands((h) => h.map((cards, i) => (i === who ? [...cards, stock[0]] : cards)));
        setStock((s) => s.slice(1));
      }
    }
    if (play.kind === "play") setHands((h) => h.map((cards, i) => (i === who ? cards.filter((c) => c !== play.card) : cards)));
    setMoves((m) => [...m, { wallet: SEATS[who], n: pile.turn, data: play }]);
  };

  // The computer players: the first card that goes (an 8 last, calling their commonest suit), else draw.
  useEffect(() => {
    if (screen !== "playing" || pile.winner !== null || seat === 0) return;
    const t = window.setTimeout(() => {
      const cards = hands[seat];
      const ok = cards.filter((c) => canPlay(c, pile.top!, pile.called!)).sort((a, b) => Number(rankOf(a) === WILD) - Number(rankOf(b) === WILD));
      if (!ok.length) return take(seat, { kind: "draw" });
      const card = ok[0];
      const suit = SUITS.map((s) => [s, cards.filter((c) => suitOf(c) === s).length] as const).sort((a, b) => b[1] - a[1])[0][0];
      take(seat, { kind: "play", card, suit: rankOf(card) === WILD ? suit : undefined });
    }, 500);
    return () => window.clearTimeout(t);
  });

  // The end of a round: 100 for going out first.
  useEffect(() => {
    if (screen !== "playing" || pile.winner === null || ended.current) return;
    ended.current = true;
    if (pile.winner === 0) scoreRef.current += 100;
    setScore(scoreRef.current);
    probe(scoreRef.current);
    round(false);
    if (saveBest(scoreRef.current, BEST_KEY)) setBest(scoreRef.current);
    if (pile.winner === 0) sfx.win();
    else sfx.hit();
    setScreen("over");
  });

  const play = (card: Card, suit?: Suit) => {
    if (seat !== 0 || pile.winner !== null) return;
    moved();
    scoreRef.current += 10;
    setScore(scoreRef.current);
    probe(scoreRef.current);
    sfx.coin();
    buzz("collect");
    take(0, { kind: "play", card, suit });
  };

  const drawOne = () => {
    if (seat !== 0 || pile.winner !== null) return;
    moved();
    sfx.tap();
    take(0, { kind: "draw" });
  };

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[460px] overflow-hidden rounded-2xl bg-card p-4 shadow">
        {screen === "start" && (
          <div className="space-y-5">
            {!inRoom && (
              <GameMenu
                card={false}
                title={GAME_NAME}
                tagline={"First to play all their cards wins."}
                best={best}
                onPlay={begin}
                playLabel="Play the computer"
                howTo={["Play a card that matches the top card's suit or number.", "An 8 goes on anything, and you pick the next suit.", "Can't go? Draw one.", "First with no cards wins. Play the computer alone, or make a room below for friends."]}
              />
            )}
            <div className="space-y-3 border-t pt-4">
              <h3 className="font-semibold">With friends (2 to 6)</h3>
              <RoomLobby<Play> config={ROOM} onRoom={setInRoom}>
                {(live) => <OnlineCards live={live} />}
              </RoomLobby>
            </div>
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-3">
            <p className="text-2xl font-semibold tabular-nums">{score}</p>
            <CardTable pile={pile} names={NAMES} me={0} hand={hands[0]} busy={screen !== "playing"} onPlay={play} onDraw={drawOne} />
          </div>
        )}
        {screen === "over" && (
          <GameOver score={score} best={best} stats={[{ label: "Result", value: pile.winner === 0 ? "You went out first" : NAMES[pile.winner ?? 0] + " won" }]} onAgain={begin} shareText={"I scored " + score + " in " + GAME_NAME} />
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
    </div>
  );
}
`;

export const lastCard: GameTemplate = {
  id: "last-card",
  name: "Shedding card game",
  dims: "2d",
  style: "turns",
  fits: "card games for 2 to 6 where you get rid of your cards by matching the top card's suit or number, with wild cards that change the suit (crazy-eights style, whot-style), with friends in a room or against computer players, for points only",
  kits: ["game-2d"],
  files: {
    ...ROOM_FILES,
    ...CARD_FILES,
    "src/App.tsx": appFor("./play/info", "GAME_NAME"),
    "src/play/info.ts": INFO,
    "src/play/rules.ts": RULES,
    "src/play/CardTable.tsx": TABLE,
    "src/play/Online.tsx": ONLINE,
    "src/play/Game.tsx": GAME,
  },
  rules: { ...ROOM_RULES, hands: "dealt" },
  multiplayer: true,
  title: { from: "./play/info", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Shedding card game template, a working, tested game for 2 to 6: src/play/rules.ts (the hand size, what can go on what, the replay of moves), src/play/CardTable.tsx (one player's table), src/play/Online.tsx (a round in a room, with hands from GoodBuild's dealer), src/play/Game.tsx (the start screen and a round against computer players), src/cards/ (the deck and the card face) and src/room/ (the room). Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY, and ROOM.game in Game.tsx), restyle the cards and the table to the plan's look, and change the rules the plan asks for in rules.ts (special cards such as skip or pick two, the hand size). Keep it original: never another card game's brand, names or art.
- Hands come only from GoodBuild's dealer ("hands": "dealt"), never from a player's device: keep that rule in src/lib/dataRules.json. Played cards are public moves.
- Points only: never bets, stakes or prizes in money or tokens (GoodBuild doesn't build gambling).
- ${ROOM_BRIEF}
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every card played or drawn, probe(score) when the score changes, the hand and Draw inside <div data-game-area>, GameOver with Play again, free play with no wallet.`,
};
