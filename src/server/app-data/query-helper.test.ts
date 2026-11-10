// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { checkApp } from "@/server/agent/checks";
import { closeRunCheckBrowser, runCheck } from "@/server/agent/run-check";
import { starterFiles } from "@/server/agent/template";
import { typeCheck } from "@/server/agent/type-check";

const RULES = JSON.stringify({ collections: { scores: { create: "anyone", read: ["anyone"], fields: { player: "string", points: "number" } } } });
const PAGE = `import { useEffect } from "react";
import { collection } from "./lib/db";
import { useCollection } from "./lib/useDb";

export default function App() {
  const board = useCollection<{ player: string; points: number }>("scores", { where: [["points", "gte", 15]], orderBy: "points", dir: "desc", limit: 5, liveEvery: 3000 });
  useEffect(() => {
    void (async () => {
      const scores = collection<{ player: string; points: number }>("scores");
      if ((await scores.list()).records.length === 0) {
        await scores.add({ player: "Ada", points: 30 });
        await scores.add({ player: "Bayo", points: 10 });
        await scores.add({ player: "Chi", points: 20 });
        await board.refresh();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <main className="p-4">
      <h1>Top scores</h1>
      <ol>{board.records.map((r) => <li key={r.key}>{r.value.player}: {r.value.points}</li>)}</ol>
      <p>{board.records.length} shown</p>
    </main>
  );
}
`;
const project = (): Record<string, string> => ({ ...starterFiles(), "src/lib/dataRules.json": RULES, "src/App.tsx": PAGE });

describe("queries in the app's data helper", { timeout: 120_000 }, () => {
  afterAll(() => closeRunCheckBrowser());

  it("passes the app check and the type check", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("filters and sorts in the preview too, in a real browser", async () => {
    const r = await runCheck(project(), { screenshots: false });
    if (!r.ran) return; // no browser here: CI has one
    expect(r.issues).toEqual([]);
  });
});
