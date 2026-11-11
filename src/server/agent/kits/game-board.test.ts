// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { runContractTests } from "../contract-tests";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "../template";
import { typeCheck } from "../type-check";
import { miniAppChecks } from "./mini-app";
import { game2d } from "./game-2d";
import { gameBoard } from "./game-board";
import { kitById, withKit } from "./index";

/** A game in MiniPay with the board: the contract's ABI module, as GoodBuild writes it after a build. */
async function project(app: string): Promise<Record<string, string>> {
  let files = withKit(withKit(withKit(starterFiles(), game2d), kitById("mini-app")!), gameBoard);
  const report = await checkContracts(files);
  expect(report.errors).toEqual([]);
  files = { ...files, "src/App.tsx": app };
  for (const c of report.contracts) files[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi, { 11142220: "0x00000000000000000000000000000000000000b0" });
  files[`${PLATFORM_DIR}index.ts`] = contractsIndex(report.contracts.map((c) => c.name));
  const rules = JSON.parse(files["src/lib/dataRules.json"]) as { collections?: Record<string, unknown> };
  files["src/lib/dataRules.json"] = JSON.stringify({ ...rules, collections: { ...(rules.collections ?? {}), scores: { create: "signed-in", read: ["anyone"], fields: { name: "string", score: "number", extra: "string" } } } });
  return files;
}

const APP = `import { GameBoardAbi, GameBoardAddress } from "./contracts";
import { Leaderboard, PostScore } from "./game/Leaderboard";
import { gameBoard } from "./game/chainBoard";
import { useLeaderboard } from "./game/leaderboard";
import { chain } from "./lib/chain";
import { MiniFooter } from "./minipay/MiniFooter";
import { INFO_ROUTES } from "./minipay/InfoPages";

const miniPayBoard = gameBoard(GameBoardAbi, GameBoardAddress[chain.id]);

export default function App() {
  const board = useLeaderboard({ chain: miniPayBoard });
  return (
    <main>
      <Leaderboard board={board} />
      <PostScore board={board} score={12} />
      <p hidden>{INFO_ROUTES.length}</p>
      <MiniFooter />
    </main>
  );
}
`;

describe("the MiniPay leaderboard contract (D93)", { timeout: 180_000 }, () => {
  it("compiles, and its own tests pass in the local EVM", async () => {
    const files = withKit(starterFiles(), gameBoard);
    const report = await checkContracts(files);
    expect(report.errors).toEqual([]);
    expect(report.contracts.map((c) => c.name)).toContain("GameBoard");
    const { results, issues } = await runContractTests(report);
    expect(issues).toEqual([]);
    expect(results.map((r) => r.test).sort()).toEqual(["testExploitUnauthorizedCall", "testKeepsTheTop25", "testNameRules", "testOnlyABestCounts", "testRanksHighestFirst"]);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("a game that passes it to useLeaderboard passes the app check, the MiniPay checks and the type check", async () => {
    const files = await project(APP);
    // MINI_APP's wording is the owner's to fill in; everything else must pass.
    expect(checkApp(files).errors.filter((e) => e.file !== "src/minipay/app.ts")).toEqual([]);
    // The kit's leaderboard signs in outside MiniPay only: the MiniPay sign-in check leaves it alone.
    expect(miniAppChecks(files).filter((i) => /sign-in|signature/.test(i.message))).toEqual([]);
    const types = await typeCheck(files);
    expect(types.ran).toBe(true);
    expect(types.issues).toEqual([]);
  });

  it("asks for the contract to be passed when the game forgets it", async () => {
    const forgot = APP.replace("useLeaderboard({ chain: miniPayBoard })", "useLeaderboard()");
    const errors = checkApp(await project(forgot)).errors;
    expect(errors.map((e) => e.message).join(" ")).toMatch(/MiniPay players can't post to the leaderboard/);
  });

  it("is only turned on by its own words, never by a plain leaderboard", () => {
    expect(gameBoard.keywords.test("a snake game with a leaderboard")).toBe(false);
    expect(gameBoard.keywords.test("an onchain leaderboard for my game")).toBe(true);
  });
});
