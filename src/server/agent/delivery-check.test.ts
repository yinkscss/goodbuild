// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";
import { TIC_TAC_TOE } from "../../../test/fixtures/tic-tac-toe";
import { closeRunCheckBrowser, runCheck } from "./run-check";
import { starterFiles } from "./template";

afterAll(() => closeRunCheckBrowser());
const delivery = { id: "interface", goal: "A Tic-tac-toe game with wallets and G$ staking" };
describe("independent first-game browser acceptance", () => {
  it("plays X and O wins, draw, occupied-cell protection and restart", async () => {
    const result = await runCheck({ ...starterFiles(), "src/App.tsx": TIC_TAC_TOE }, { delivery });
    expect(result.ran, result.note).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.deliveryVerified).toBe(true);
  });
  it("rejects a static counter disguised as tic-tac-toe", async () => {
    const result = await runCheck({ ...starterFiles(), "src/App.tsx": 'export default function App(){return <main><h1>Tic-tac-toe</h1><button>Play</button></main>}' }, { delivery });
    expect(result.ran, result.note).toBe(true);
    expect(result.issues.some((i) => i.message.includes("nine playable cells"))).toBe(true);
    expect(result.deliveryVerified).toBe(false);
  });
  it("rejects a board that never reports a winner", async () => {
    const broken = TIC_TAC_TOE.replace('winner ? winner+" wins"', 'winner ? "Keep playing"');
    const result = await runCheck({ ...starterFiles(), "src/App.tsx": broken }, { delivery });
    expect(result.ran, result.note).toBe(true);
    expect(result.issues.some((i) => i.message.includes("X result was not reported"))).toBe(true);
  });
});
