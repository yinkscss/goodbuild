// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp } from "../checks";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { detectKits, kitIdsOf, withKit } from "./index";
import { miniApp } from "./mini-app";

const PAGE = `import { MiniFooter } from "./minipay/MiniFooter";
import { coinInfo } from "./minipay/minipay";
export default function App() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1>Tip jar</h1>
      <p>{coinInfo("USDC").decimals}</p>
      <MiniFooter links={{ about: "#/about", howToUse: "#/how", terms: "#/terms", privacy: "#/privacy", support: "#/support" }} />
    </main>
  );
}
`;
const project = (app = PAGE): Record<string, string> => ({ ...withKit(starterFiles(), miniApp), "src/App.tsx": app });

describe("the MiniPay kit", { timeout: 120_000 }, () => {
  it("is picked for MiniPay and stablecoin requests only", () => {
    const wants = (r: string) => detectKits(r, starterFiles()).includes(miniApp);
    for (const yes of ["A tip jar that works in MiniPay", "Take USDC payments for my shop", "a mini app for Opera", "Pay in USDT"]) expect(wants(yes), yes).toBe(true);
    for (const no of ["A tip jar for our football club", "A landing page for my coffee kiosk"]) expect(wants(no), no).toBe(false);
  });

  it("adds no packages, and puts the real stablecoin addresses in the helper", () => {
    expect(miniApp.packages).toEqual({});
    expect(kitIdsOf(project())).toEqual(["mini-app"]);
    const helper = project()["src/minipay/minipay.ts"];
    expect(helper).toContain("0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e");
    expect(helper).toContain("0xe19447B12cb0d0220B2a501D8382be2f61CcF92a");
  });

  it("passes the app check and the type check with a page that uses it", async () => {
    expect(checkApp(project()).errors).toEqual([]);
    const types = await typeCheck(project());
    if (types.ran) expect(types.issues).toEqual([]);
  });

  it("refuses signing, EIP-1559 fields, 18-decimal dollar maths and a missing footer", () => {
    const messages = (body: string) => checkApp(project(PAGE + body)).errors.map((e) => e.message).join("\n");
    expect(messages("\nconst a = (w: { signMessage: () => void }) => w.signMessage();\n")).toMatch(/signature to log in/);
    expect(messages("\nconst b = { maxFeePerGas: 1n };\n")).toMatch(/legacy/);
    expect(messages('\nconst c = parseEther("1"); // USDC\n')).toMatch(/6 decimals/);
    expect(checkApp(project("export default function App() { return <main>Hi</main>; }\n")).errors.map((e) => e.message).join()).toMatch(/MiniFooter/);
  });
});
