/**
 * Playing cards shared by the card templates (D143, PR 8 of D139): a deck, shuffling and a card face
 * with GoodBuild's own look. Cards are short strings ("QH" is the queen of hearts, "10S" the ten of
 * spades), so they fit the dealer's decks and records as they are.
 */

const CARDS_TS = `// Playing cards as short strings: rank then suit. "AS" ace of spades, "10H" ten of hearts, "QD", "7C".

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;
export type Suit = (typeof SUITS)[number];
export type Card = string;

export const SUIT_SIGN: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" };

export const suitOf = (card: Card) => card.slice(-1) as Suit;
export const rankOf = (card: Card) => card.slice(0, -1);
/** Ace 1 up to king 13. */
export const valueOf = (card: Card) => RANKS.indexOf(rankOf(card) as (typeof RANKS)[number]) + 1;
export const isRed = (card: Card) => suitOf(card) === "H" || suitOf(card) === "D";

/** The 52 cards in order. */
export function fullDeck(): Card[] {
  return SUITS.flatMap((s) => RANKS.map((r) => r + s));
}

/** A shuffled copy. Pass a seeded random for the same order everywhere, or leave it for Math.random. */
export function shuffle<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** "Queen of hearts", for screen readers. */
export function cardName(card: Card): string {
  const r = rankOf(card);
  const word: Record<string, string> = { A: "Ace", J: "Jack", Q: "Queen", K: "King" };
  return (word[r] ?? r) + " of " + SUIT_NAME[suitOf(card)];
}
`;

const CARD_FACE_TSX = `import { SUIT_SIGN, cardName, isRed, rankOf, suitOf, type Card } from "./cards";

/**
 * One card, GoodBuild's own look: a rounded white face with the rank and suit, or a back. Restyle it to
 * the plan. size is the width in pixels; the height follows (5:7).
 */
export function CardFace({ card, down = false, size = 56, selected = false }: { card?: Card; down?: boolean; size?: number; selected?: boolean }) {
  const style = { width: size, height: Math.round(size * 1.4), fontSize: Math.round(size * 0.32) };
  if (down || !card) {
    return <span aria-label="Face-down card" className="inline-block rounded-lg bg-primary shadow-sm ring-2 ring-inset ring-primary-foreground/30" style={style} />;
  }
  return (
    <span
      aria-label={cardName(card)}
      className={"relative inline-flex select-none flex-col justify-between rounded-lg bg-white p-1 font-semibold leading-none shadow-sm " + (isRed(card) ? "text-danger" : "text-foreground") + (selected ? " ring-4 ring-warning" : "")}
      style={style}
    >
      <span>{rankOf(card)}</span>
      <span className="self-center text-[1.6em]">{SUIT_SIGN[suitOf(card)]}</span>
      <span className="self-end rotate-180">{rankOf(card)}</span>
    </span>
  );
}
`;

export const CARD_FILES: Record<string, string> = {
  "src/cards/cards.ts": CARDS_TS,
  "src/cards/CardFace.tsx": CARD_FACE_TSX,
};
