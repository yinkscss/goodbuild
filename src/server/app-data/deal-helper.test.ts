// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { checkApp } from "@/server/agent/checks";
import { closeRunCheckBrowser, runCheck } from "@/server/agent/run-check";
import { starterFiles } from "@/server/agent/template";
import { typeCheck } from "@/server/agent/type-check";

const RULES = JSON.stringify({ collections: { hands: "dealt" } });
// Deals in the preview, reads the hand back, draws, and tries to write a hand itself. Any mismatch throws,
// which the run check reports as a crash.
const PAGE = `import { useEffect, useState } from "react";
import { collection, deal, dealInfo, draw, signIn, type DealtHand } from "./lib/db";

const OTHER = "0x00000000000000000000000000000000000000b2";
// Once per page: React's development mode runs effects twice.
let started = false;

export default function App() {
  const [done, setDone] = useState("dealing");
  useEffect(() => {
    if (started) return;
    started = true;
    void (async () => {
      const me = await signIn();
      const deck = Array.from({ length: 20 }, (_, i) => "card" + i);
      const receipt = await deal("hands", { room: "ABCDE", players: [me, OTHER], deck, hand: 5 });
      if (receipt.stock !== 10 || receipt.hands.join() !== "5,5" || JSON.stringify(receipt).includes("card")) throw new Error("dealer: bad receipt");
      const mine = (await collection<DealtHand>("hands").list()).records;
      if (mine.length !== 1 || mine[0].value.items.length !== 5 || mine[0].owner !== me) throw new Error("dealer: I should see exactly my own hand, saw " + JSON.stringify(mine.map((r) => [r.owner, r.value.items.length])) + " as " + me);
      const drew = await draw("hands", receipt.id, 2);
      if (drew.items.length !== 2 || drew.deal.stock !== 8 || mine[0].value.items.some((c) => drew.items.includes(c))) throw new Error("dealer: bad draw");
      if ((await dealInfo("hands", receipt.id)).drawn.join() !== "1,0") throw new Error("dealer: bad info");
      let refused = false;
      try {
        await collection<DealtHand>("hands").put("mine", { deal: "x", room: "x", items: ["ace"] });
      } catch {
        refused = true;
      }
      if (!refused) throw new Error("dealer: a hand was written without the dealer");
      setDone("dealt " + (await collection<DealtHand>("hands").list()).records.length);
    })().catch((e) => setTimeout(() => { throw e; }));
  }, []);
  return <main className="p-4"><p>{done}</p></main>;
}
`;
const project = (): Record<string, string> => ({ ...starterFiles(), "src/lib/dataRules.json": RULES, "src/App.tsx": PAGE });

describe("the dealer in the app's data helper (D141)", { timeout: 120_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("passes the app check and the type check", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("deals, reads only your own hand, draws, and refuses a hand written by the app, in the preview", async () => {
    const r = await runCheck(project(), { screenshots: false });
    if (!r.ran) return; // no browser here: CI has one
    expect(r.issues).toEqual([]);
  });

  it("a broken check would be caught: a page whose expectation fails is reported", async () => {
    const wrong = project();
    wrong["src/App.tsx"] = wrong["src/App.tsx"].replace("receipt.stock !== 10", "receipt.stock !== 11");
    const r = await runCheck(wrong, { screenshots: false });
    if (!r.ran) return;
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/dealer: bad receipt/);
  });
});
