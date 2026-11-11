// @vitest-environment node
import { describe, expect, it } from "vitest";

import { checkApp } from "../checks";
import { starterFiles } from "../template";
import { typeCheck } from "../type-check";

import { detectKits, kitIdsOf, withKit } from "./index";
import { MINIPAY_CHECKLIST, miniApp, miniPayChecklist } from "./mini-app";

const PAGE = `import { HashRouter, Route, Routes } from "react-router-dom";
import { InfoPage, INFO_ROUTES } from "./minipay/InfoPages";
import { MiniFooter } from "./minipay/MiniFooter";
import { coinInfo } from "./minipay/minipay";
function Home() {
  return (
    <main className="mx-auto max-w-sm p-4">
      <h1>Tip jar</h1>
      <p>{coinInfo("USDC").decimals}</p>
      <MiniFooter />
    </main>
  );
}
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route index element={<Home />} />
        {INFO_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<InfoPage kind={r.kind} />} />)}
      </Routes>
    </HashRouter>
  );
}
`;
const named = (files: Record<string, string>) => ({ ...files, "src/minipay/app.ts": files["src/minipay/app.ts"].replace('name: "My app"', 'name: "Tip jar"') });
const project = (app = PAGE): Record<string, string> => named({ ...withKit(starterFiles(), miniApp), "src/App.tsx": app });

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

  it("refuses links that open a new tab (D88)", () => {
    const messages = checkApp(project(PAGE + '\nexport const L = () => <a href="https://celo.org" target="_blank">Celo</a>;\n')).errors.map((e) => e.message).join("\n");
    expect(messages).toMatch(/new tab/);
  });

  it("gives the builder the whole checklist, and says which items a project meets (D88)", () => {
    for (const item of MINIPAY_CHECKLIST) expect(miniApp.guide).toContain(item.label);
    const status = (files: Record<string, string>) => Object.fromEntries(miniPayChecklist(files).map((i) => [i.id, i.status]));
    // A game with no payments: everything checked is met, the payment items don't apply, the rest is for the phone and the listing.
    expect(status(project())).toEqual({
      "auto-connect": "done",
      "no-sign-in": "done",
      "legacy-tx": "not-needed",
      decimals: "not-needed",
      "add-cash": "not-needed",
      "no-new-tabs": "done",
      footer: "done",
      "app-info": "done",
      "phone-layout": "try-on-phone",
      "opens-in-minipay": "try-on-phone",
      verified: "for-listing",
    });
    const paying = project(PAGE + "\nimport { sendCoin } from \"./minipay/minipay\";\nexport const pay = () => sendCoin({ coin: \"USDC\", to: \"0x0000000000000000000000000000000000000001\", amount: \"1\" });\n");
    expect(status(paying)).toMatchObject({ "legacy-tx": "done", decimals: "done", "add-cash": "todo" });
    const broken = { ...project("export default function App() { return <a href=\"x\" target=\"_blank\">x</a>; }\n"), "src/minipay/app.ts": withKit(starterFiles(), miniApp)["src/minipay/app.ts"] };
    expect(status(broken)).toMatchObject({ footer: "todo", "no-new-tabs": "todo", "app-info": "todo" });
  });

  it("brings the five info pages, so the builder doesn't write them", () => {
    const files = withKit(starterFiles(), miniApp);
    const pages = files["src/minipay/InfoPages.tsx"];
    for (const path of ["about", "how-to-use", "terms", "privacy", "support"]) expect(pages).toContain(`path: "${path}"`);
    expect(pages).toContain("not run by Opera or MiniPay");
    expect(files["src/minipay/MiniFooter.tsx"]).toContain("links = MINI_LINKS");
    expect(miniApp.guide).toMatch(/already written/);
    expect(miniApp.guide).toMatch(/bar fixed to the bottom/);
  });

  it("asks for the five routes, and for the app's name to be filled in", () => {
    const withoutRoutes = project(PAGE.replace("INFO_ROUTES.map", "[].map").replace("import { InfoPage, INFO_ROUTES }", "import { InfoPage }"));
    expect(checkApp(withoutRoutes).errors.map((e) => e.message).join()).toMatch(/INFO_ROUTES/);
    const untouched = { ...project(), "src/minipay/app.ts": withKit(starterFiles(), miniApp)["src/minipay/app.ts"] };
    expect(checkApp(untouched).errors.map((e) => e.message).join()).toMatch(/Fill in MINI_APP/);
  });
});
