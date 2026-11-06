// End-to-end check of the wallet layer generated apps get (D35), on a real production build: an app
// is published through the real API and opened on <slug>.localhost in Chromium.
//
//   1. Start the server: NODE_ENV=production PUBLISHED_APPS_DOMAIN=localhost APP_DOMAIN=localhost:$PORT
//      SESSION_SECRET=<32+ chars> DATABASE_URL=<throwaway database> GOODBUILD_INLINE_WORKER=0
//      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=<id> pnpm start -p $PORT
//   2. PORT=$PORT DATABASE_URL=<same> PLAYWRIGHT_PATH=<playwright(-core) package> [CHROMIUM_PATH=<binary>] \
//      [SHOTS=<folder for screenshots>] node --import tsx --require ./scripts/worker-preload.cjs scripts/wallet-e2e.ts
//
// Wallets are stand-ins injected into the page: EIP-6963 announcements with real signatures from keys
// made here, and a MiniPay-style window.ethereum. Celo Sepolia's RPC is answered by this script, so
// the contract write runs the app's whole path (simulate, send, wait for the receipt) without funds.
// WalletConnect really talks to its relay: the check is that the QR code appears with no CSP errors.
import http from "node:http";
import path from "node:path";

import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

import { saveFiles } from "@/server/agent/store";
import { starterFiles } from "@/server/agent/template";
import { signInUser } from "@/server/auth/service";
import { getDb } from "@/server/db/client";
import { createProjectFromPrompt } from "@/server/projects";

const PORT = Number(process.env.PORT ?? 3457);
const SLUG = `wallet-${Date.now().toString(36)}`;
const APP_HOST = `${SLUG}.localhost:${PORT}`;
const MAIN_HOST = `localhost:${PORT}`;
const RPC = celoSepolia.rpcUrls.default.http[0];
const CHAIN_HEX = "0x" + celoSepolia.id.toString(16);
const TARGET = "0x00000000000000000000000000000000000000c0";
const TX_HASH = "0x" + "ab".repeat(32);

const APP = `import { useState } from "react";
import { ConnectButton } from "./components/ConnectButton";
import { writeContract } from "./lib/chain";
import { useDbSession } from "./lib/useDb";
import { useWallet } from "./lib/useWallet";
import { errorMessage } from "./lib/format";

const abi = [{ type: "function", name: "tip", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] }] as const;

export default function App() {
  const wallet = useWallet();
  const session = useDbSession();
  const [tx, setTx] = useState("");
  const write = async () => {
    setTx("sending");
    try {
      const receipt = await writeContract({ address: "${TARGET}", abi, functionName: "tip", args: [BigInt(7)] });
      setTx(receipt.status + " " + receipt.transactionHash);
    } catch (e) {
      setTx("error: " + errorMessage(e));
    }
  };
  return (
    <main className="p-6 grid gap-3">
      <ConnectButton />
      <p id="account">{wallet.account ?? "none"}</p>
      <p id="wallet-name">{wallet.walletName ?? ""}</p>
      <p id="who">{session.loading ? "loading" : session.wallet ?? "signed out"}</p>
      <p id="session-error">{session.error}</p>
      <button id="sign-in" onClick={() => void session.signIn()}>Sign in</button>
      <button id="write" onClick={() => void write()}>Tip</button>
      <p id="tx">{tx}</p>
    </main>
  );
}
`;

const results: boolean[] = [];
function check(name: string, ok: boolean, detail?: unknown) {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail !== undefined ? `  (${typeof detail === "string" ? detail : JSON.stringify(detail)})` : ""}`);
}

/** http.request to 127.0.0.1 with a Host header: Node's fetch can't reach <slug>.localhost reliably. */
function send(host: string, method: string, urlPath: string, options: { cookie?: string; json?: unknown } = {}) {
  const body = options.json !== undefined ? JSON.stringify(options.json) : undefined;
  const headers: Record<string, string> = { host, origin: `http://${host}`, "sec-fetch-site": "same-origin", ...(options.cookie ? { cookie: options.cookie } : {}), ...(body ? { "content-type": "application/json", "content-length": String(Buffer.byteLength(body)) } : {}) };
  return new Promise<{ status: number; text: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, method, path: urlPath, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

async function signInMain(account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await send(MAIN_HOST, "GET", "/api/auth/nonce");
  const nonceCookie = String(nonceRes.headers["set-cookie"]?.[0] ?? "").split(";")[0];
  const message = createSiweMessage({ address: account.address, chainId: celoSepolia.id, domain: MAIN_HOST, uri: `http://${MAIN_HOST}`, version: "1", nonce: (JSON.parse(nonceRes.text) as { nonce: string }).nonce, issuedAt: new Date() });
  const res = await send(MAIN_HOST, "POST", "/api/auth/verify", { cookie: nonceCookie, json: { message, signature: await account.signMessage({ message }), walletKind: "external", attestation: { ageOk: true, notUsPerson: true } } });
  if (res.status !== 200) throw new Error(`main sign-in failed: ${res.status} ${res.text}`);
  return (res.headers["set-cookie"] ?? []).map((c) => c.split(";")[0]).filter((c) => c.includes("gb_session=") && !c.endsWith("=")).join("; ");
}

/** Answers Celo Sepolia's JSON-RPC for the write: the call simulates, the receipt says success. */
function rpcAnswer(method: string, params: unknown[]): unknown {
  switch (method) {
    case "eth_chainId":
      return CHAIN_HEX;
    case "eth_blockNumber":
      return "0x100";
    case "eth_call":
      return "0x";
    case "eth_getTransactionReceipt":
      return { transactionHash: params[0], status: "0x1", blockNumber: "0xff", blockHash: "0x" + "cd".repeat(32), transactionIndex: "0x0", from: "0x0000000000000000000000000000000000000001", to: TARGET, cumulativeGasUsed: "0x5208", gasUsed: "0x5208", effectiveGasPrice: "0x1", logs: [], logsBloom: "0x" + "00".repeat(256), type: "0x2", contractAddress: null };
    case "eth_getTransactionByHash":
      return { hash: params[0], blockNumber: "0xff", blockHash: "0x" + "cd".repeat(32), from: "0x0000000000000000000000000000000000000001", to: TARGET, nonce: "0x0", value: "0x0", input: "0x", gas: "0x5208", transactionIndex: "0x0", type: "0x2", chainId: CHAIN_HEX };
    case "eth_getBlockByNumber":
      return { number: "0x100", hash: "0x" + "ef".repeat(32), timestamp: "0x1", transactions: [], baseFeePerGas: "0x1" };
    default:
      return null;
  }
}

type Page = {
  goto(url: string): Promise<unknown>;
  click(selector: string): Promise<void>;
  waitForSelector(selector: string, o?: object): Promise<unknown>;
  waitForFunction(fn: unknown, arg?: unknown, o?: object): Promise<unknown>;
  textContent(selector: string): Promise<string | null>;
  evaluate(fn: unknown, arg?: unknown): Promise<unknown>;
  screenshot(o: object): Promise<unknown>;
  locator(selector: string): { count(): Promise<number>; allTextContents(): Promise<string[]> };
  on(event: string, fn: (...a: never[]) => void): void;
  route(url: string | RegExp, fn: (route: { request(): { postData(): string | null }; fulfill(o: object): unknown }) => unknown): Promise<void>;
};
type Context = { newPage(): Promise<Page>; addInitScript(s: string): Promise<void>; exposeBinding(name: string, fn: (...a: never[]) => unknown): Promise<void>; close(): Promise<void> };
type Browser = { newContext(o?: object): Promise<Context>; close(): Promise<void> };

/** CSP violations, page errors and console errors, collected from the start of the page. */
const WATCH = `window.__problems = [];
document.addEventListener("securitypolicyviolation", (e) => window.__problems.push("CSP " + e.violatedDirective + " " + e.blockedURI));`;

function watch(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", ((e: Error) => problems.push("pageerror " + e.message)) as never);
  page.on("console", ((m: { type(): string; text(): string }) => {
    if (m.type() === "error" && !/status of 40[134]/.test(m.text())) problems.push("console " + m.text());
  }) as never);
  return async () => [...problems, ...((await page.evaluate(() => (window as unknown as { __problems: string[] }).__problems)) as string[])];
}

async function mockRpc(page: Page, seen: string[]) {
  await page.route(RPC, (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as { id: number; method: string; params: unknown[] } | Array<{ id: number; method: string; params: unknown[] }>;
    const answer = (r: { id: number; method: string; params: unknown[] }) => {
      seen.push(r.method);
      return { jsonrpc: "2.0", id: r.id, result: rpcAnswer(r.method, r.params) };
    };
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(Array.isArray(body) ? body.map(answer) : answer(body)) });
  });
}

/** An EIP-6963 wallet that signs with a real key, plus a decoy that must never be asked. */
async function injectedWallets(browser: Browser, account: PrivateKeyAccount) {
  const context = await browser.newContext();
  await context.exposeBinding("__sign", ((_s: unknown, hex: `0x${string}`) => account.signMessage({ message: { raw: hex } })) as never);
  await context.addInitScript(WATCH);
  await context.addInitScript(`(() => {
    const calls = (window.__walletCalls = []);
    const make = (name, address) => ({
      request: async ({ method, params }) => {
        calls.push(name + ":" + method);
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [address];
        if (method === "eth_chainId") return "${CHAIN_HEX}";
        if (method === "personal_sign") return window.__sign(params[0]);
        if (method === "eth_sendTransaction") { window.__sentTx = params[0]; return "${TX_HASH}"; }
        if (method === "wallet_switchEthereumChain") return null;
        return null;
      },
      on() {},
      removeListener() {},
    });
    const test = make("test", "${account.address}");
    const other = make("other", "0x00000000000000000000000000000000000000d1");
    // A wallet that grabbed window.ethereum: the old helpers would have used it without asking.
    window.ethereum = make("hijacker", "0x00000000000000000000000000000000000000e1");
    const icon = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%23592e81'/%3E%3C/svg%3E";
    const announce = () => {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "1", name: "Test Wallet", icon, rdns: "xyz.goodbuild.test" }, provider: test }) }));
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "2", name: "Other Wallet", icon, rdns: "xyz.goodbuild.other" }, provider: other }) }));
    };
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  })();`);
  return context;
}

async function main() {
  const shots = process.env.SHOTS;
  const db = await getDb();
  const owner = privateKeyToAccount(generatePrivateKey());
  const visitor = privateKeyToAccount(generatePrivateKey());

  // --- Publish through the real API ---
  const cookie = await signInMain(owner);
  const user = await signInUser(db, { wallet: owner.address, walletKind: "external" });
  const project = await createProjectFromPrompt(db, user.id, { prompt: "wallet test", network: "celo-sepolia" });
  await saveFiles(db, project.id, { ...starterFiles(), "src/App.tsx": APP });
  const published = await send(MAIN_HOST, "POST", `/api/projects/${project.id}/publish`, { cookie, json: { slug: SLUG, confirmed: true } });
  check(`published ${SLUG}`, published.status === 200, published.text.slice(0, 300));
  const page = await send(APP_HOST, "GET", "/");
  check("the page carries the WalletConnect project id", /name="goodbuild-walletconnect" content="[^"]+"/.test(page.text), page.text.slice(0, 400));
  const csp = String(page.headers["content-security-policy"]);
  check("CSP: scripts stay 'self' only, Verify's frame is allowed", csp.includes("script-src 'self';") && !csp.includes("unsafe-eval") && csp.includes("frame-src 'self' https://verify.walletconnect.org"), csp);

  const loaded = (await import(process.env.PLAYWRIGHT_PATH as string)) as { chromium: { launch(o: object): Promise<Browser> }; default?: { chromium: { launch(o: object): Promise<Browser> } } };
  const browser = await (loaded.default ?? loaded).chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--disable-features=LocalNetworkAccessChecks"] });
  const url = `http://${APP_HOST}/`;
  try {
    // --- 1. Browser wallets (EIP-6963): pick one, sign in, write ---
    const context = await injectedWallets(browser, visitor);
    const a = await context.newPage();
    const problems = watch(a);
    const rpc: string[] = [];
    await mockRpc(a, rpc);
    await a.goto(url);
    await a.click("text=Connect wallet");
    await a.waitForSelector('[role="dialog"]');
    const listed = await a.locator('[role="dialog"] li').allTextContents();
    check("the wallet list shows both announced wallets and WalletConnect", listed.some((t) => t.startsWith("Test Wallet")) && listed.some((t) => t.startsWith("Other Wallet")) && listed.some((t) => t.startsWith("WalletConnect")), listed);
    check("the wallet that took window.ethereum is one choice among them, not used silently", listed.length === 4 && listed.some((t) => t.startsWith("Browser wallet")), listed);
    if (shots) await a.screenshot({ path: path.join(shots, "1-wallet-list.png") });
    await a.click('[role="dialog"] button:has-text("Test Wallet")');
    await a.waitForFunction((w: string) => document.querySelector("#account")?.textContent === w, visitor.address, { timeout: 15000 });
    check("connects the picked wallet", (await a.textContent("#wallet-name")) === "Test Wallet");
    await a.click("#sign-in");
    await a.waitForFunction((w: string) => document.querySelector("#who")?.textContent === w, visitor.address.toLowerCase(), { timeout: 15000 });
    check("signs in to the app's data with the picked wallet (db.ts signIn)", true);
    await a.click("#write");
    await a.waitForFunction(() => /^(success|error)/.test(document.querySelector("#tx")?.textContent ?? ""), undefined, { timeout: 30000 });
    const tx = await a.textContent("#tx");
    const sent = (await a.evaluate(() => (window as unknown as { __sentTx?: { to: string; data: string; from: string } }).__sentTx)) as { to: string; data: string; from: string } | undefined;
    check("writeContract sends through the picked wallet and waits for the receipt", tx === `success ${TX_HASH}` && sent?.to?.toLowerCase() === TARGET && sent?.data?.startsWith("0x") === true && sent?.from?.toLowerCase() === visitor.address.toLowerCase(), { tx, sent, rpc });
    const calls = (await a.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls)) as string[];
    check("the other wallet and window.ethereum were never asked for accounts or signatures", !calls.some((c) => /^(other|hijacker):(eth_requestAccounts|personal_sign|eth_sendTransaction)/.test(c)), calls);
    await a.goto(url);
    await a.waitForFunction((w: string) => document.querySelector("#account")?.textContent === w, visitor.address, { timeout: 15000 });
    check("reconnects the same wallet on the next visit without asking", !(await a.evaluate(() => (window as unknown as { __walletCalls: string[] }).__walletCalls.includes("test:eth_requestAccounts"))));
    check("no CSP violations or errors in the browser-wallet flow", (await problems()).length === 0, await problems());
    await context.close();

    // --- 2. MiniPay: connects on load, no list ---
    const mini = await browser.newContext();
    await mini.addInitScript(WATCH);
    await mini.addInitScript(`window.ethereum = { isMiniPay: true, request: async ({ method }) => method === "eth_chainId" ? "${CHAIN_HEX}" : (method === "eth_requestAccounts" || method === "eth_accounts") ? ["0x00000000000000000000000000000000000000aa"] : null, on() {}, removeListener() {} };`);
    const m = await mini.newPage();
    const miniProblems = watch(m);
    await m.goto(url);
    await m.waitForFunction(() => document.querySelector("#account")?.textContent === "0x00000000000000000000000000000000000000aa", undefined, { timeout: 15000 });
    check("MiniPay connects on its own, with no wallet list", (await m.locator('[role="dialog"]').count()) === 0 && (await m.textContent("#wallet-name")) === "MiniPay");
    check("no CSP violations or errors in MiniPay", (await miniProblems()).length === 0, await miniProblems());
    await mini.close();

    // --- 3. No browser wallet (a phone's Chrome or Safari): WalletConnect QR on a computer ---
    const bare = await browser.newContext();
    await bare.addInitScript(WATCH);
    const b = await bare.newPage();
    const wcProblems = watch(b);
    const hosts = new Set<string>();
    b.on("request", ((r: { url(): string }) => hosts.add(new URL(r.url()).host)) as never);
    await b.goto(url);
    await b.click("text=Connect wallet");
    await b.waitForSelector('[role="dialog"]');
    check("with no browser wallet, the list offers WalletConnect instead of 'No wallet found'", (await b.locator('[role="dialog"] li').allTextContents()).join("|").startsWith("WalletConnect"));
    await b.click('[role="dialog"] button:has-text("WalletConnect")');
    await b.waitForSelector("[data-goodbuild-qr] svg", { timeout: 30000 });
    const uri = (await b.evaluate(() => document.querySelector("[data-goodbuild-qr] svg title")?.textContent ?? document.querySelector("[data-goodbuild-qr] svg")?.outerHTML.length)) as unknown;
    check("the WalletConnect QR code appears", true, uri);
    await b.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 3000)); // let the relay and Verify settle
    if (shots) await b.screenshot({ path: path.join(shots, "2-walletconnect-qr.png") });
    const wcErrors = (await wcProblems()).filter((p) => p.startsWith("CSP") || /Content Security Policy/i.test(p));
    check("no CSP violations while WalletConnect connects", wcErrors.length === 0, wcErrors);
    console.log(`INFO  hosts the WalletConnect step reached: ${[...hosts].filter((h) => !h.includes("localhost")).join(", ") || "(none)"}`);
    const other = (await wcProblems()).filter((p) => !wcErrors.includes(p));
    if (other.length) console.log(`INFO  other console output in the WalletConnect step: ${other.slice(0, 5).join(" | ")}`);
    await bare.close();

    // --- 4. A phone: a button per wallet with the WalletConnect link ---
    const phone = await browser.newContext({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await phone.addInitScript(WATCH);
    const p = await phone.newPage();
    await p.goto(url);
    await p.click("text=Connect wallet");
    await p.click('[role="dialog"] button:has-text("WalletConnect")');
    await p.waitForSelector('a[href^="https://valoraapp.com/wc?uri=wc%3A"]', { timeout: 30000 });
    const links = (await p.evaluate(() => [...document.querySelectorAll('[role="dialog"] a')].map((x) => (x as HTMLAnchorElement).getAttribute("href")?.split("?")[0]))) as string[];
    check("on a phone: MetaMask, Valora, Trust Wallet, Rainbow and 'Other wallet' links carry the WalletConnect link", links.length === 5 && links.includes("https://metamask.app.link/wc") && links.at(-1)?.startsWith("wc:") === true, links);
    if (shots) await p.screenshot({ path: path.join(shots, "3-phone-wallets.png") });
    await phone.close();
  } finally {
    await browser.close();
  }

  const failed = results.filter((ok) => !ok).length;
  console.log(failed ? `\n${failed} check(s) failed` : `\nall ${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
