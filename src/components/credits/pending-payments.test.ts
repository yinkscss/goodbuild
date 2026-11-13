import { beforeEach, describe, expect, it } from "vitest";

import { forgetPending, readPending, redeemTx, retryPending, savePending } from "./pending-payments";

const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const reply = (status: number, body: unknown = {}) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("pending credit payments (GB-01)", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps a sent payment across page loads until it is forgotten", () => {
    savePending(42220, hash(1));
    savePending(42220, hash(1));
    savePending(42220, hash(2));
    expect(readPending().map((p) => p.hash)).toEqual([hash(1), hash(2)]);
    forgetPending(hash(1));
    expect(readPending().map((p) => p.hash)).toEqual([hash(2)]);
  });

  it("drops entries older than a week and anything malformed", () => {
    savePending(42220, hash(3), Date.now() - 8 * 24 * 60 * 60 * 1000);
    window.localStorage.setItem("gb:credits:pending", JSON.stringify([...JSON.parse(window.localStorage.getItem("gb:credits:pending")!), { chainId: 42220, hash: "nope", at: Date.now() }]));
    expect(readPending()).toEqual([]);
    window.localStorage.setItem("gb:credits:pending", "{not json");
    expect(readPending()).toEqual([]);
  });

  it("reads the server's answer", async () => {
    expect(await redeemTx(42220, hash(4), reply(200, { events: 1, creditedMicro: 500_000, balanceMicro: 900_000 }) as never)).toEqual({ kind: "credited", addedMicro: 500_000, balanceMicro: 900_000 });
    expect(await redeemTx(42220, hash(4), reply(200, { events: 1, creditedMicro: 0, balanceMicro: 900_000 }) as never)).toEqual({ kind: "credited", addedMicro: 0, balanceMicro: 900_000 });
    expect(await redeemTx(42220, hash(4), reply(200, { events: 0, creditedMicro: 0 }) as never)).toEqual({ kind: "not_credits" });
    expect(await redeemTx(42220, hash(4), reply(202, { pending: true }) as never)).toEqual({ kind: "pending" });
    expect(await redeemTx(42220, hash(4), reply(500, { message: "down" }) as never)).toEqual({ kind: "failed", message: "down" });
    expect(await redeemTx(42220, hash(4), (async () => Promise.reject(new Error("offline"))) as never)).toEqual({ kind: "failed" });
  });

  it("on the next page load, sends saved payments again and forgets only the settled ones", async () => {
    savePending(42220, hash(10)); // credited now
    savePending(42220, hash(11)); // not mined yet
    savePending(42220, hash(12)); // reverted on-chain
    savePending(42220, hash(13)); // server error
    const seen: string[] = [];
    const fetcher = (async (_url: string, init: RequestInit) => {
      const { txHash } = JSON.parse(String(init.body)) as { txHash: string };
      seen.push(txHash);
      if (txHash === hash(10)) return reply(200, { events: 1, creditedMicro: 1_000_000, balanceMicro: 1_000_000 })();
      if (txHash === hash(11)) return reply(202, { pending: true })();
      if (txHash === hash(12)) return reply(200, { events: 0, creditedMicro: 0 })();
      return reply(500)();
    }) as never;
    expect(await retryPending(fetcher)).toBe(1_000_000);
    expect(seen).toEqual([hash(10), hash(11), hash(12), hash(13)]);
    expect(readPending().map((p) => p.hash)).toEqual([hash(11), hash(13)]);
  });
});
