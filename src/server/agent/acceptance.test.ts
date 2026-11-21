// @vitest-environment node
import { afterAll, describe, expect, it } from "vitest";

import { acceptanceSummary, formatFlowResults, parseFlows } from "./acceptance";
import { CHECK_WALLET_SHORT } from "./game-check";
import { closeRunCheckBrowser, runCheck } from "./run-check";
import { SPEC_PATH, parseSpec, readSpec, specBlock } from "./spec";
import { starterFiles } from "./template";

afterAll(() => closeRunCheckBrowser());

const APP = `import { useState } from "react";
import { ConnectButton } from "./components/ConnectButton";
export default function App() {
  const [amount, setAmount] = useState("");
  const [sent, setSent] = useState("");
  const [broken, setBroken] = useState(false);
  if (broken) throw new Error("the tip list blew up");
  return (
    <main>
      <h1>Tip the club</h1>
      <ConnectButton />
      <label htmlFor="amt">Amount</label>
      <input id="amt" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="How much" />
      <button onClick={() => setSent(amount)}>Send tip</button>
      <button onClick={() => setBroken(true)}>Break it</button>
      {sent && <p>Thanks for {sent} G$</p>}
      <p hidden>Shown twice</p>
      <p>Shown twice</p>
      <a href="#/about">About</a>
    </main>
  );
}
`;

describe("parseFlows (D152)", () => {
  it("accepts the documented steps", () => {
    const { flows, problems } = parseFlows([
      {
        name: "Send a tip",
        steps: [
          { goto: "about" },
          { fill: { label: "Amount" }, value: 50 },
          { click: { role: "Button", name: "Send tip" } },
          { press: "Enter" },
          { expect: { text: "Thanks" } },
          { expect: { hidden: "Error" } },
          { expect: { route: "/" } },
          { wait: 9000 },
          { connectWallet: true },
          { click: { testid: "jar" } },
          { fill: { placeholder: "Name" }, value: "Ada" },
        ],
      },
    ]);
    expect(problems).toEqual([]);
    expect(flows[0].needs).toBe("local");
    expect(flows[0].steps[0]).toEqual({ goto: "/about" });
    expect(flows[0].steps[1]).toEqual({ fill: { label: "Amount" }, value: "50" });
    expect(flows[0].steps[2]).toEqual({ click: { role: "button", name: "Send tip" } });
    expect(flows[0].steps[7]).toEqual({ wait: 2000 });
  });
  it("names each problem by flow and step, and drops flows that can't run", () => {
    const { flows, problems } = parseFlows([
      { name: "Bad", steps: [{ hover: { text: "x" } }, { click: { role: "spaceship" } }, { press: "Control+Alt+Delete" }] },
      { name: "Needs", needs: "server", steps: [{ goto: "/" }] },
      { name: "Empty", steps: [] },
      { name: "Long", steps: Array.from({ length: 21 }, () => ({ goto: "/" })) },
      { name: "Listed", needs: ["deployed"], steps: [{ goto: "/" }] },
    ]);
    expect(flows).toEqual([]);
    expect(problems).toEqual([
      '"Bad" step 1: unknown step ["hover"]: use goto, click, fill, press, expect, wait or connectWallet',
      expect.stringContaining('"Bad" step 2: click: role "spaceship"'),
      '"Bad" step 3: press takes one key such as Enter, Escape or Tab',
      '"Needs": needs is local, wallet or deployed',
      '"Empty": needs at least one step',
      '"Long": at most 20 steps',
      '"Listed": needs is local, wallet or deployed',
    ]);
  });
  it("makes the spec call fix a flow that can't run", () => {
    const spec = { summary: "s", direction: "d", pages: [], contracts: [], acceptance: [{ name: "Tip", steps: [{ tap: "Send" }] }] };
    const parsed = parseSpec(spec);
    expect(parsed.ok).toBe(false);
    expect(!parsed.ok && parsed.error).toContain('"Tip" step 1');
    // acceptance must be an array; an empty one is fine.
    expect(parseSpec({ ...spec, acceptance: { name: "Tip", steps: [] } })).toMatchObject({ ok: false, error: expect.stringContaining("acceptance: an array") });
    expect(parseSpec({ ...spec, acceptance: [] }).ok).toBe(true);
  });

  it("shows a long spec compact with its flows first, and says when it was cut off", () => {
    const flows = [{ name: "Tip", steps: [{ expect: { text: "Tips" } }] }];
    const big = { summary: "s", direction: "d", contracts: [], acceptance: flows, pages: Array.from({ length: 12 }, (_, i) => ({ route: `/p${i}`, purpose: "p".repeat(300), elements: Array.from({ length: 20 }, () => "e".repeat(160)) })) };
    const block = specBlock({ [SPEC_PATH]: JSON.stringify(big, null, 2) });
    expect(block).toContain('Acceptance flows: [{"name":"Tip"');
    expect(block.indexOf("Acceptance flows:")).toBeLessThan(block.indexOf('"pages"'));
    expect(block).toContain(`read_file ${SPEC_PATH} for all of it`);
    // Flows big enough to fill the block on their own are still shown whole.
    const long = "x".repeat(200);
    const heavy = { ...big, acceptance: ["One", "Two"].map((name) => ({ name, steps: Array.from({ length: 20 }, () => ({ fill: { label: long }, value: long })) })) };
    const heavyBlock = specBlock({ [SPEC_PATH]: JSON.stringify(heavy, null, 2) });
    const shown = readSpec({ [SPEC_PATH]: JSON.stringify(heavy) })!.acceptance;
    expect(heavyBlock).toContain(`Acceptance flows: ${JSON.stringify(shown)}`);
    const small = { ...big, pages: [] };
    expect(specBlock({ [SPEC_PATH]: JSON.stringify(small, null, 2) })).toContain(JSON.stringify(small, null, 2));
  });
});

describe("acceptance flows in a real browser (D152)", { timeout: 120_000 }, () => {
  const files = { ...starterFiles(), "src/App.tsx": APP };

  it("passes a flow that works, fails one that doesn't with the step and the page, and skips a deployed one", async () => {
    const result = await runCheck(files, {
      acceptance: {
        flows: [
          { name: "Send a tip", steps: [{ fill: { label: "Amount" }, value: "50" }, { click: { role: "button", name: "Send tip" } }, { expect: { text: "Thanks for 50 G$" } }, { expect: { hidden: "Something went wrong" } }] },
          { name: "Pay now", steps: [{ expect: { role: "heading", name: "Tip the club" } }, { click: { role: "button", name: "Pay now" } }] },
          { name: "About page", steps: [{ click: { role: "link", name: "About" } }, { expect: { route: "/about" } }] },
          { name: "Live tip", needs: "deployed", steps: [{ goto: "/" }] },
        ],
      },
    });
    expect(result.ran, result.note).toBe(true);
    const [tip, pay, about, live] = result.acceptance!;
    expect(tip).toEqual({ name: "Send a tip", needs: "local", status: "pass" });
    expect(pay.status).toBe("fail");
    expect(pay.step).toBe(2);
    expect(pay.reason).toContain('step 2 (click button "Pay now") failed');
    expect(pay.outline).toContain("button: Send tip");
    expect(about.status).toBe("pass");
    expect(live.status).toBe("skipped");
    // Flows are reported, never turned into issues by the run check itself.
    expect(result.issues).toEqual([]);
    expect(acceptanceSummary(result.acceptance!)).toBe('2 of 3 flows pass (1 skipped: need a deployed contract or ran out of time); "Pay now" failed at step 2 (click button "Pay now") failed: ' + pay.reason!.split("failed: ")[1]);
    expect(formatFlowResults(result.acceptance!)).toContain("What the page showed:");
  });

  it("connects the stand-in wallet through the app's own button", async () => {
    const result = await runCheck(files, { acceptance: { flows: [{ name: "Connect", needs: "wallet", steps: [{ connectWallet: true }, { expect: { text: CHECK_WALLET_SHORT } }] }] } });
    expect(result.ran, result.note).toBe(true);
    expect(result.acceptance).toEqual([{ name: "Connect", needs: "wallet", status: "pass" }]);
  });

  it("passes the wallet step when the page shows the full address, not just the short one", async () => {
    const full = `import { useWallet } from "./lib/useWallet";
export default function App() {
  const { account, connect } = useWallet();
  return <main><h1>Stash</h1>{account ? <p>Connected as {account}</p> : <button onClick={() => connect()}>Connect wallet</button>}</main>;
}
`;
    const result = await runCheck({ ...files, "src/App.tsx": full }, { acceptance: { flows: [{ name: "Connect", needs: "wallet", steps: [{ connectWallet: true }] }] } });
    expect(result.ran, result.note).toBe(true);
    expect(result.acceptance).toEqual([{ name: "Connect", needs: "wallet", status: "pass" }]);
  });

  it("reports a crash during a flow, an invalid flow, and runs only the flows asked for", async () => {
    const result = await runCheck(files, {
      acceptance: {
        flows: [
          { name: "Break it", steps: [{ click: { role: "button", name: "Break it" } }, { expect: { text: "Tip the club" } }] },
          { name: "Typo", steps: [{ clik: { text: "x" } }] },
          { name: "Send a tip", steps: [{ expect: { text: "Tip the club" } }] },
        ],
        only: "break",
      },
    });
    expect(result.ran, result.note).toBe(true);
    expect(result.acceptance?.map((r) => [r.name, r.status])).toEqual([["invalid flow", "fail"], ["Break it", "fail"]]);
    expect(result.acceptance?.[1].reason).toContain("the app crashed: the tip list blew up");
  });

  it("fails expect hidden when any match is still visible, not just the first", async () => {
    const result = await runCheck(files, { acceptance: { flows: [{ name: "Gone", steps: [{ expect: { hidden: "Shown twice" } }] }, { name: "Never there", steps: [{ expect: { hidden: "Not on the page" } }] }] } });
    expect(result.ran, result.note).toBe(true);
    expect(result.acceptance?.map((r) => [r.name, r.status])).toEqual([["Gone", "fail"], ["Never there", "pass"]]);
  });
});
