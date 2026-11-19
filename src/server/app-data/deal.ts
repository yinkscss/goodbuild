import "server-only";

import { randomInt, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { DEAL_LIMITS, ruleFor } from "@/lib/app-data";
import type { Db } from "@/server/db/client";
import { appDataDeals } from "@/server/db/app-data-schema";
import type { AppDataLimits } from "./limits";
import { AppDataError, putRecord, type LiveApp, type Viewer } from "./store";

/**
 * GoodBuild's dealer (D141, docs/APP_DATA.md "The dealer"). A host asks the server to shuffle a deck and
 * deal it: each player's share is written as that player's own record in a "dealt" collection, which
 * only they can read, and the rest stays here as the stock, which nobody can read. Players draw from it.
 * Every function takes the project from the caller, which derives it from the Host.
 */

export interface DealInput {
  room: string;
  players: string[];
  deck: string[];
  hand: number;
}

/** What anyone in the deal may know: who is in it and how many items each holds. Never the items. */
export interface DealReceipt {
  id: string;
  room: string;
  host: string;
  players: string[];
  hands: number[];
  drawn: number[];
  stock: number;
}

const WALLET = /^0x[0-9a-f]{40}$/;

function fail(code: string, status: number, message: string): never {
  throw new AppDataError(code, status, message);
}

/** A deal's request, checked. Messages are for the app's builder. */
export function checkDeal(raw: Record<string, unknown>): DealInput {
  const room = typeof raw.room === "string" ? raw.room : "";
  if (room.length > DEAL_LIMITS.roomChars || !/^[\x20-\x7e]*$/.test(room)) fail("invalid_deal", 400, `room must be plain text of at most ${DEAL_LIMITS.roomChars} characters.`);
  const players = Array.isArray(raw.players) ? raw.players.map((p) => (typeof p === "string" ? p.toLowerCase() : "")) : [];
  if (players.length < 2 || players.length > DEAL_LIMITS.maxPlayers || players.some((p) => !WALLET.test(p)) || new Set(players).size !== players.length) {
    fail("invalid_deal", 400, `players must be 2 to ${DEAL_LIMITS.maxPlayers} different wallet addresses.`);
  }
  const deck = Array.isArray(raw.deck) ? raw.deck : [];
  if (!deck.length || deck.length > DEAL_LIMITS.maxDeck || deck.some((d) => typeof d !== "string" || !d.length || d.length > DEAL_LIMITS.itemChars || !/^[\x20-\x7e]+$/.test(d))) {
    fail("invalid_deal", 400, `deck must be 1 to ${DEAL_LIMITS.maxDeck} items, each plain text of 1 to ${DEAL_LIMITS.itemChars} characters.`);
  }
  const hand = raw.hand;
  if (typeof hand !== "number" || !Number.isInteger(hand) || hand < 1 || hand * players.length > deck.length) {
    fail("invalid_deal", 400, "hand must be a whole number from 1, with enough items in the deck for every player.");
  }
  return { room, players, deck: deck as string[], hand };
}

/** Fisher-Yates with the operating system's randomness, so nobody, the host included, can predict it. */
export function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function dealtCollection(app: LiveApp, collection: string) {
  if (!ruleFor(app.rules, collection).dealt) fail("not_dealt", 400, `"${collection}" isn't a dealt collection. Declare it in dataRules.json as "${collection}": "dealt".`);
}

function receipt(row: typeof appDataDeals.$inferSelect): DealReceipt {
  return { id: row.id, room: row.room, host: row.host, players: row.players, hands: row.hands, drawn: row.drawn, stock: row.stock.length };
}

/** Shuffle and deal. Every hand and the deal itself are saved together, or none of them. */
export async function createDeal(db: Db, app: LiveApp, host: Viewer, collection: string, input: DealInput, limits: AppDataLimits, now = new Date()): Promise<DealReceipt> {
  dealtCollection(app, collection);
  const deck = shuffled(input.deck);
  const id = randomUUID();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(appDataDeals)
      .values({
        id,
        projectId: app.projectId,
        collection,
        host: host.subject,
        room: input.room,
        players: input.players,
        stock: deck.slice(input.players.length * input.hand),
        hands: input.players.map(() => input.hand),
        drawn: input.players.map(() => 0),
        createdAt: now,
      })
      .returning();
    for (const [i, player] of input.players.entries()) {
      const items = deck.slice(i * input.hand, (i + 1) * input.hand);
      await putRecord(tx as unknown as Db, app, { collection, owner: player, key: id, json: JSON.stringify({ deal: id, room: input.room, items }) }, limits, now, null, { dealer: true });
    }
    return receipt(row);
  });
}

/** The deal, for its host and players only. Anyone else gets "no such deal", the same as for one that doesn't exist. */
export async function dealInfo(db: Db, app: LiveApp, viewer: Viewer, collection: string, id: string): Promise<DealReceipt> {
  dealtCollection(app, collection);
  const [row] = await db
    .select()
    .from(appDataDeals)
    .where(and(eq(appDataDeals.projectId, app.projectId), eq(appDataDeals.collection, collection), eq(appDataDeals.id, id)))
    .limit(1);
  if (!row || (row.host !== viewer.subject && !row.players.includes(viewer.subject))) fail("not_found", 404, "There's no such deal.");
  return receipt(row);
}

/** A player in the deal takes the top of the stock. Written for them only, and returned to them only. */
export async function drawFromDeal(db: Db, app: LiveApp, viewer: Viewer, collection: string, id: string, count: number, limits: AppDataLimits, now = new Date()): Promise<{ items: string[]; deal: DealReceipt }> {
  dealtCollection(app, collection);
  if (!Number.isInteger(count) || count < 1 || count > DEAL_LIMITS.maxDraw) fail("invalid_deal", 400, `count must be 1 to ${DEAL_LIMITS.maxDraw}.`);
  return db.transaction(async (tx) => {
    // The deal's row is locked, so two draws at once never take the same item.
    const [row] = await tx
      .select()
      .from(appDataDeals)
      .where(and(eq(appDataDeals.projectId, app.projectId), eq(appDataDeals.collection, collection), eq(appDataDeals.id, id)))
      .for("update");
    const seat = row ? row.players.indexOf(viewer.subject) : -1;
    if (!row || seat < 0) fail("not_found", 404, "There's no such deal.");
    if (!row.stock.length) fail("stock_empty", 409, "There's nothing left to draw.");
    const items = row.stock.slice(0, count);
    const drawn = row.drawn.map((n, i) => (i === seat ? n + 1 : n));
    const hands = row.hands.map((n, i) => (i === seat ? n + items.length : n));
    const [next] = await tx.update(appDataDeals).set({ stock: row.stock.slice(items.length), drawn, hands }).where(eq(appDataDeals.id, row.id)).returning();
    await putRecord(tx as unknown as Db, app, { collection, owner: viewer.subject, key: `${id}.d${drawn[seat]}`, json: JSON.stringify({ deal: id, room: row.room, items }) }, limits, now, null, { dealer: true });
    return { items, deal: receipt(next) };
  });
}
