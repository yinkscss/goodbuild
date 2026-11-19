import { CARD_FILES } from "./cards";
import type { GameTemplate } from "./index";
import { appFor } from "./shared";

/**
 * Solitaire (D143, PR 8 of D139): Klondike rules, GoodBuild's own look. Seven columns, four foundations
 * built up by suit from the ace, the stock dealt three at a time, three passes through it. Tap a card to
 * move it where it can go (a foundation first), which suits a phone. For points only.
 */

const INFO = `export const GAME_NAME = "Patience Lane";
export const BEST_KEY = "patience-lane";
`;

const RULES = `// Klondike solitaire, with no screen: the deal, the moves and the score.
import { SUITS, fullDeck, isRed, shuffle, suitOf, valueOf, type Card } from "../cards/cards";

/** Cards turned from the stock at a time, and times through it. */
export const DRAW = 3;
export const PASSES = 3;

export interface Pile {
  down: Card[];
  up: Card[];
}
export interface Table {
  stock: Card[];
  /** The top is the last card. */
  waste: Card[];
  /** One per suit, in SUITS order, ace first. */
  found: Card[][];
  piles: Pile[];
  /** Passes through the stock so far, counting the first. */
  pass: number;
  score: number;
}

export function deal(deck: Card[] = shuffle(fullDeck())): Table {
  const cards = [...deck];
  const piles: Pile[] = Array.from({ length: 7 }, (_, i) => {
    const take = cards.splice(0, i + 1);
    return { down: take.slice(0, -1), up: take.slice(-1) };
  });
  return { stock: cards, waste: [], found: SUITS.map(() => []), piles, pass: 1, score: 0 };
}

const clone = (t: Table): Table => ({ ...t, stock: [...t.stock], waste: [...t.waste], found: t.found.map((f) => [...f]), piles: t.piles.map((p) => ({ down: [...p.down], up: [...p.up] })) });
const top = <T,>(a: T[]) => a[a.length - 1];

function onFoundation(t: Table, card: Card): boolean {
  return t.found[SUITS.indexOf(suitOf(card))].length === valueOf(card) - 1;
}
function onPile(pile: Pile, card: Card): boolean {
  const last = top(pile.up);
  if (!last) return pile.down.length === 0 && valueOf(card) === 13;
  return isRed(last) !== isRed(card) && valueOf(last) === valueOf(card) + 1;
}

/** Turn the column's top card once its face-up cards are gone: 5 points. */
function flip(t: Table, pile: Pile) {
  if (!pile.up.length && pile.down.length) {
    pile.up.push(pile.down.pop()!);
    t.score += 5;
  }
}

/** Turn cards from the stock, or put the waste back for another pass. Null when neither is allowed. */
export function draw(t: Table): Table | null {
  const n = clone(t);
  if (n.stock.length) {
    n.waste.push(...n.stock.splice(0, DRAW));
    return n;
  }
  if (n.waste.length && n.pass < PASSES) {
    n.stock = n.waste;
    n.waste = [];
    n.pass++;
    return n;
  }
  return null;
}

export type From = { from: "waste" } | { from: "pile"; pile: number; index: number };

/** Where a tapped card goes: a foundation if it can, else the first column that takes it. Null when nowhere. */
export function move(t: Table, src: From): Table | null {
  const n = clone(t);
  const run = src.from === "waste" ? (n.waste.length ? [top(n.waste)] : []) : n.piles[src.pile].up.slice(src.index);
  if (!run.length) return null;
  const card = run[0];
  const takeAway = () => {
    if (src.from === "waste") n.waste.pop();
    else {
      n.piles[src.pile].up.splice(src.index);
      flip(n, n.piles[src.pile]);
    }
  };
  if (run.length === 1 && onFoundation(n, card)) {
    takeAway();
    n.found[SUITS.indexOf(suitOf(card))].push(card);
    n.score += 10;
    return n;
  }
  // Non-empty columns first, so a king isn't moved to an empty column it already fills.
  const order = n.piles.map((p, i) => i).sort((a, b) => Number(n.piles[b].up.length > 0) - Number(n.piles[a].up.length > 0));
  for (const i of order) {
    if (src.from === "pile" && i === src.pile) continue;
    if (src.from === "pile" && valueOf(card) === 13 && src.index === 0 && n.piles[src.pile].down.length === 0 && !n.piles[i].up.length) continue;
    if (onPile(n.piles[i], card)) {
      takeAway();
      n.piles[i].up.push(...run);
      return n;
    }
  }
  return null;
}

export const won = (t: Table) => t.found.every((f) => f.length === 13);

/** No card can move and the stock can't be turned: the round is over. */
export function stuck(t: Table): boolean {
  if (draw(t)) return false;
  if (move(t, { from: "waste" })) return false;
  return !t.piles.some((p, pile) => p.up.some((_, index) => move(t, { from: "pile", pile, index }) !== null));
}
`;

const GAME = `import { useRef, useState } from "react";
import { CardFace } from "../cards/CardFace";
import { SUIT_SIGN, SUITS } from "../cards/cards";
import { GameOver } from "../game/GameOver";
import { GameSettings } from "../game/GameSettings";
import { buzz } from "../game/haptics";
import { declareGame, moved, probe, round } from "../game/probe";
import { sfx } from "../game/sound";
import { bestScore, saveBest } from "../game/storage";
import { BEST_KEY, GAME_NAME } from "./info";
import { PASSES, deal, draw, move, stuck, won, type From, type Table } from "./rules";

// A card puzzle with no rush, played by tapping cards. Keep this in step with the game.
declareGame({ style: "puzzle", controls: ["buttons"] });

/** Points for finishing the whole deck. */
const WIN_BONUS = 200;
const SIZE = 44;

type Screen = "start" | "playing" | "over";

export default function Game() {
  const [screen, setScreen] = useState<Screen>("start");
  const [t, setT] = useState<Table>(() => deal());
  const [best, setBest] = useState(() => bestScore(BEST_KEY));
  const [nudge, setNudge] = useState<string | null>(null);
  const final = useRef(0);

  const finish = (end: Table) => {
    final.current = end.score + (won(end) ? WIN_BONUS : 0);
    probe(final.current);
    round(false);
    if (saveBest(final.current, BEST_KEY)) setBest(final.current);
    sfx.win();
    setScreen("over");
  };

  const start = () => {
    const fresh = deal();
    setT(fresh);
    setNudge(null);
    final.current = 0;
    setScreen("playing");
    round(true);
    probe(0);
    sfx.tap();
  };

  const apply = (next: Table | null) => {
    if (screen !== "playing") return;
    moved();
    if (!next) {
      setNudge("That card can't move yet.");
      buzz("hit");
      return;
    }
    setNudge(null);
    if (next.score > t.score) {
      sfx.coin();
      buzz("collect");
    } else sfx.tap();
    setT(next);
    probe(next.score);
    if (won(next) || stuck(next)) finish(next);
  };

  const tap = (src: From) => apply(move(t, src));

  return (
    <div className="mx-auto w-full max-w-md space-y-4">
      <div className="relative min-h-[520px] overflow-hidden rounded-2xl bg-card p-3 shadow">
        {screen === "start" && (
          <div className="flex min-h-[460px] flex-col items-center justify-center gap-4 text-center">
            <h2 className="text-2xl font-semibold">{GAME_NAME}</h2>
            <p className="text-muted-foreground">Build each suit up from the ace. Tap a card to move it; tap the deck to turn three. {PASSES} times through the deck.</p>
            {best > 0 && <p className="text-sm">Your best: {best}</p>}
            <button type="button" onClick={start} className="w-full rounded-xl bg-primary px-6 py-3 text-lg font-semibold text-primary-foreground">
              Play
            </button>
          </div>
        )}
        {screen !== "start" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-sm tabular-nums">
              <span className="text-2xl font-semibold">{t.score}</span>
              <span>Pass {t.pass}/{PASSES}</span>
            </div>
            <div data-game-area className="space-y-3">
              <div className="flex items-start gap-1.5">
                <button type="button" aria-label={t.stock.length ? "Turn three cards" : "Turn the deck over"} onClick={() => apply(draw(t))} className="rounded-lg">
                  {t.stock.length ? <CardFace down size={SIZE} /> : <span className="inline-block rounded-lg border-2 border-dashed border-muted-foreground/40" style={{ width: SIZE, height: SIZE * 1.4 }} />}
                </button>
                <button type="button" aria-label="Move the top card of the turned cards" disabled={!t.waste.length} onClick={() => tap({ from: "waste" })} className="rounded-lg">
                  {t.waste.length ? <CardFace card={t.waste[t.waste.length - 1]} size={SIZE} /> : <span className="inline-block" style={{ width: SIZE }} />}
                </button>
                <span className="flex-1" />
                {SUITS.map((s, i) => (
                  <span key={s} className="inline-flex items-center justify-center rounded-lg bg-muted text-muted-foreground" style={{ width: SIZE, height: SIZE * 1.4 }}>
                    {t.found[i].length ? <CardFace card={t.found[i][t.found[i].length - 1]} size={SIZE} /> : SUIT_SIGN[s]}
                  </span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {t.piles.map((p, pile) => (
                  <div key={pile} className="flex flex-col items-center">
                    {p.down.map((_, i) => (
                      <span key={"d" + i} className="-mb-12 block">
                        <CardFace down size={SIZE} />
                      </span>
                    ))}
                    {p.up.map((card, index) => (
                      <button key={card} type="button" onClick={() => tap({ from: "pile", pile, index })} className={"block rounded-lg " + (index < p.up.length - 1 ? "-mb-9" : "")}>
                        <CardFace card={card} size={SIZE} />
                      </button>
                    ))}
                    {!p.up.length && !p.down.length && <span className="inline-block rounded-lg border-2 border-dashed border-muted-foreground/30" style={{ width: SIZE, height: SIZE * 1.4 }} />}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground" aria-live="polite">{nudge ?? ""}</span>
              {screen === "playing" && (
                <button type="button" onClick={() => finish(t)} className="underline">
                  End game
                </button>
              )}
            </div>
          </div>
        )}
        {screen === "over" && (
          <GameOver score={final.current} best={best} stats={[{ label: "Cards home", value: t.found.reduce((n, f) => n + f.length, 0) + "/52" }]} onAgain={start} shareText={"I scored " + final.current + " in " + GAME_NAME} />
        )}
      </div>
      {screen !== "playing" && <GameSettings />}
    </div>
  );
}
`;

export const solitaire: GameTemplate = {
  id: "solitaire",
  name: "Solitaire",
  dims: "2d",
  style: "puzzle",
  fits: "one-player patience card games with Klondike rules: seven columns, build each suit up from the ace, turn cards from the deck",
  kits: ["game-2d"],
  files: { ...CARD_FILES, "src/App.tsx": appFor("./play/info", "GAME_NAME"), "src/play/info.ts": INFO, "src/play/rules.ts": RULES, "src/play/Game.tsx": GAME },
  title: { from: "./play/info", name: "GAME_NAME" },
  brief: `This game starts from GoodBuild's Solitaire template, a working, tested Klondike game: src/play/rules.ts (the deal, the moves, the score), src/play/Game.tsx (the table), src/play/info.ts (its name), src/cards/ (the deck and the card face) and src/App.tsx. Reshape it to the plan instead of starting again:
- Rename it (GAME_NAME, BEST_KEY), restyle the cards (src/cards/CardFace.tsx) and the table to the plan's look, and change the rules the plan asks for in rules.ts (one card at a time instead of three, more passes). Keep the look GoodBuild's own, never a copy of another solitaire app.
- Points only: never bets or prizes in money or tokens.
- Keep what makes it work: round(true) at Play and round(false) at the end, moved() on every tap, probe(score) when the score changes, the cards and the deck inside <div data-game-area>, GameOver on the game with Play again, free play with no wallet. It has no leaderboard: a round ends only when the player is stuck, wins or ends it.`,
};
