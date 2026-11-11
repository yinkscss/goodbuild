// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp, checkContracts } from "../checks";
import { runContractTests } from "../contract-tests";
import { PLATFORM_DIR, contractModule, contractsIndex, starterFiles } from "../template";
import { typeCheck } from "../type-check";
import { rolesOf } from "./dao-vault";
import { game2d } from "./game-2d";
import { SHOP_WORDS, gameShop } from "./game-shop";
import { kitById, withKit } from "./index";

const MANIFEST = JSON.stringify({ contracts: [{ name: "GameShop", args: { gd_: "${GOODDOLLAR}" } }] });

/** A game with the shop, as GoodBuild leaves it after a build: the contract's ABI module beside it. */
async function project(app: string, extraKits: string[] = []): Promise<Record<string, string>> {
  let files = withKit(withKit(starterFiles(), game2d), gameShop);
  for (const id of extraKits) files = withKit(files, kitById(id)!);
  files = { ...files, "contracts/deploy.json": MANIFEST };
  const report = await checkContracts(files);
  expect(report.errors).toEqual([]);
  files = { ...files, "src/App.tsx": app };
  for (const c of report.contracts) files[`${PLATFORM_DIR}${c.name}.ts`] = contractModule(c.name, c.abi, { 11142220: "0x00000000000000000000000000000000000000d0" });
  files[`${PLATFORM_DIR}index.ts`] = contractsIndex(report.contracts.map((c) => c.name));
  return files;
}

const APP = `import { useState } from "react";
import { GameShopAbi, GameShopAddress } from "./contracts";
import { chain } from "./lib/chain";
import { Sprite } from "./game/Sprite";
import { Store } from "./game/Store";
import { useShop, type ShopItem } from "./game/shop";

export const SHOP: ShopItem[] = [
  { id: 0, name: "Starter", kind: "car", price: "0" },
  { id: 1, name: "Neon GT", kind: "car", price: "50", detail: "Faster" },
  { id: 2, name: "Level up", kind: "count", price: "10", detail: "+5% speed" },
  { id: 3, name: "Nitro pack", kind: "count", price: "15", perPurchase: 3 },
  { id: 4, name: "Season pass", kind: "pass", price: "100" },
];

function drawCar(ctx: CanvasRenderingContext2D, w: number, h: number, colour: string) {
  ctx.fillStyle = colour;
  ctx.fillRect(w * 0.2, 0, w * 0.6, h);
}

export default function App() {
  const shop = useShop(SHOP, GameShopAbi, GameShopAddress[chain.id]);
  const [car, setCar] = useState(0);
  const level = Math.min(10, shop.count(SHOP[2]));
  return (
    <main className="p-4">
      <p>Level {level}</p>
      <Store shop={shop} selected={car} onSelect={(item) => setCar(item.id)} draw={(item, owned) => <Sprite draw={(ctx, w, h) => drawCar(ctx, w, h, owned ? "#e11d48" : "#9ca3af")} width={64} height={96} label={item.name} />} />
    </main>
  );
}
`;

describe("the game shop (D95)", { timeout: 240_000 }, () => {
  it("compiles, and its own tests pass in the local EVM, including the attacks", async () => {
    const report = await checkContracts({ ...withKit(starterFiles(), gameShop), "contracts/deploy.json": MANIFEST });
    expect(report.errors).toEqual([]);
    const { results, issues } = await runContractTests(report);
    expect(issues).toEqual([]);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(results.map((r) => r.test)).toEqual(expect.arrayContaining(["testBuysACarOnce", "testThePassBelongsToTheSeason", "testExploitUnauthorizedCall", "testExploitFreeItemsByCallingTheHookDirectly", "testExploitReentrancy"]));
  });

  it("isn't mistaken for a vault: players buy, they don't deposit and withdraw", () => {
    expect(rolesOf(withKit(starterFiles(), gameShop))).toEqual([]);
  });

  it("a game with the store passes the app check and the type check, with and without MiniPay", async () => {
    for (const kits of [[], ["mini-app"]]) {
      const files = await project(APP, kits);
      expect(checkApp(files).errors.filter((e) => e.file !== "src/minipay/app.ts" && !/MiniFooter|INFO_ROUTES/.test(e.message))).toEqual([]);
      const types = await typeCheck(files);
      expect(types.ran).toBe(true);
      expect(types.issues).toEqual([]);
    }
  });

  it("is turned on for games that sell things, never by its words alone", () => {
    expect(gameShop.keywords.test("an in-app store")).toBe(false);
    for (const yes of ["there should be an in app store where you can purchase level ups and other cars", "a season pass", "buy new cars", "Buy level ups", "a garage of cars"]) expect(SHOP_WORDS.test(yes), yes).toBe(true);
    for (const no of ["a flappy game with a leaderboard", "tap left and right"]) expect(SHOP_WORDS.test(no), no).toBe(false);
  });
});
