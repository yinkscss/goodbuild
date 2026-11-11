// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkApp, pathProblem, walletIssues } from "./checks";
import { selectContext } from "./codebase";
import { contextMessage, systemPrompt } from "./prompt";
import { loadGuides } from "./guides";
import { starterFiles, WALLET_HELPERS, withStarterHelpers } from "./template";
import { Workspace } from "./workspace";
import { WALLET_PATHS, walletHelpersFor } from "./wallet-template";
import { buildPublishedApp, WALLETCONNECT_PATH } from "@/server/publish/build";
import { publishedHeaders } from "@/server/publish/service";

const LOCKED = Object.keys(WALLET_HELPERS);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The pre-D36 starter files, exactly as projects saved them (they never changed before D36). */
const OLD_CHAIN_SHA = "0608af3d230aefd28e613ef0c069d6e17fd43e348084151eec4288c739a8686a";

describe("the wallet layer is GoodBuild's", () => {
  it("ships in every new project, passes the checks and uses no window.ethereum outside itself", () => {
    const files = starterFiles();
    for (const p of LOCKED) expect(files[p], p).toBe(WALLET_HELPERS[p]);
    const errors = checkApp(files).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/starter page/);
    expect(files["src/lib/chain.ts"]).toContain('from "./goodbuild/wallet"');
    expect(files["src/lib/db.ts"]).toContain('from "./goodbuild/wallet"');
    expect(files["src/lib/db.ts"]).not.toContain("ethereum");
    expect(files["src/lib/useDb.ts"]).not.toContain("ethereum");
  });

  it.each([
    [11142220, "celoSepolia"],
    [42220, "celo"],
  ] as const)("builds the wallet and chain helpers for project chain %s", (chainId, selected) => {
    const files = starterFiles(chainId);
    expect(files["src/lib/chain.ts"]).toContain(`export const chain = ${selected};`);
    expect(files[WALLET_PATHS.wallet]).toContain(`export const appChain = ${selected};`);
    expect(files["src/lib/chain.ts"]).toContain("[celoSepolia.id]: celoSepolia");
    expect(files["src/lib/chain.ts"]).toContain("[celo.id]: celo");
  });

  it("the OKX additions name no chain, so each network's wallet file still imports and uses only its own (D92)", () => {
    for (const [chainId, own, other] of [
      [11142220, "celoSepolia", /\bcelo\b/],
      [42220, "celo", /\bceloSepolia\b/],
    ] as const) {
      const wallet = walletHelpersFor(chainId)[WALLET_PATHS.wallet];
      expect(wallet).toContain(`import { ${own} } from "viem/chains";`);
      expect(wallet).toContain(`export const appChain = ${own};`);
      expect(wallet).toContain('const OKX_ID = "com.okex.wallet";');
      expect(wallet).toContain("window as unknown as { okxwallet?: Provider }");
      // A build of the other chain's name would fail: its import was removed.
      expect(wallet).not.toMatch(other);
    }
  });

  it("keeps the wallet sources free of backticks and template placeholders, which their String.raw wrappers can't hold (D92)", () => {
    for (const chainId of [11142220, 42220]) {
      for (const [path, source] of Object.entries(walletHelpersFor(chainId))) {
        expect(source, path).not.toContain("`");
        expect(source, path).not.toContain("${");
      }
    }
  });

  it("refreshes a known saved chain helper when a project's network changes, but keeps custom edits", () => {
    const sepolia = starterFiles(11142220);
    const mainnet = withStarterHelpers(sepolia, 42220);
    expect(mainnet["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(mainnet[WALLET_PATHS.wallet]).toContain("export const appChain = celo;");
    const back = withStarterHelpers(mainnet, 11142220);
    expect(back["src/lib/chain.ts"]).toContain("export const chain = celoSepolia;");
    expect(back[WALLET_PATHS.wallet]).toContain("export const appChain = celoSepolia;");

    const custom = { ...sepolia, "src/lib/chain.ts": `${sepolia["src/lib/chain.ts"]}\nexport const customChainSetting = true;\n` };
    expect(withStarterHelpers(custom, 42220)["src/lib/chain.ts"]).toBe(custom["src/lib/chain.ts"]);
  });

  it("the builder can't write, edit, delete or rename the wallet files, or move another file onto them", () => {
    const ws = new Workspace(starterFiles());
    for (const p of LOCKED) {
      for (const [tool, args] of [
        ["create_file", { path: p, content: "export const connectWallet = () => fetch('https://evil.example')" }],
        ["edit_file", { path: p, edits: [{ search: "eip6963", replace: "evil" }] }],
        ["delete_file", { path: p }],
        ["rename_file", { from: p, to: "src/lib/old.ts" }],
        ["rename_file", { from: "src/lib/format.ts", to: p }],
      ] as const) {
        expect(ws.execute(tool, JSON.stringify(args), "build").ok, `${tool} ${p}`).toBe(false);
      }
    }
    for (const p of LOCKED) expect(ws.files[p]).toBe(WALLET_HELPERS[p]);
  });

  it("can't be shadowed: no new file in its folder, and no file or folder that an import would pick first", () => {
    for (const p of [
      "src/lib/goodbuild/wallet.tsx", // ./goodbuild/wallet would resolve here before wallet.ts
      "src/lib/goodbuild/walletConnect.ts",
      "src/lib/goodbuild/extra.ts",
      "src/lib/goodbuild/wallet/index.ts",
      "src/lib/goodbuild.ts",
      "src/lib/goodbuild.tsx",
      // The data helpers had the same hole: src/lib/db.tsx is tried before src/lib/db.ts.
      "src/lib/db.tsx",
      "src/lib/db/index.ts",
      "src/lib/useDb.tsx",
      "src/lib/useDb.json",
    ]) {
      expect(pathProblem(p), p).not.toBeNull();
    }
    for (const p of ["src/lib/dbHelpers.ts", "src/lib/goodbuildTheme.ts", "src/lib/walletUtils.ts", "src/lib/dataRules.json"]) expect(pathProblem(p), p).toBeNull();
    const ws = new Workspace(starterFiles());
    expect(ws.execute("create_file", JSON.stringify({ path: "src/lib/goodbuild/wallet.tsx", content: "export {}" }), "build").ok).toBe(false);
    expect(ws.execute("rename_file", JSON.stringify({ from: "src/lib/format.ts", to: "src/lib/db.tsx" }), "build").ok).toBe(false);
  });

  it("every turn restores the current files, even if a project's copy was changed or is missing", () => {
    const tampered = { ...starterFiles(), [WALLET_PATHS.wallet]: "export const connectWallet = () => 'evil';" };
    delete tampered[WALLET_PATHS.chooser];
    const next = withStarterHelpers(tampered);
    for (const p of LOCKED) expect(next[p]).toBe(WALLET_HELPERS[p]);
  });

  it("moves untouched pre-D36 copies of chain.ts, useWallet.ts and ConnectButton.tsx onto the layer, and leaves edited ones alone", () => {
    // What a project made before D36 saved (window.ethereum only).
    const oldChain = OLD_STARTER["src/lib/chain.ts"];
    expect(sha(oldChain)).toBe(OLD_CHAIN_SHA);
    const untouched = withStarterHelpers({ "src/App.tsx": "x", ...OLD_STARTER });
    expect(untouched["src/lib/chain.ts"]).toBe(starterFiles()["src/lib/chain.ts"]);
    expect(untouched["src/lib/useWallet.ts"]).toBe(starterFiles()["src/lib/useWallet.ts"]);
    expect(untouched["src/components/ConnectButton.tsx"]).toBe(starterFiles()["src/components/ConnectButton.tsx"]);
    for (const p of LOCKED) expect(untouched[p]).toBe(WALLET_HELPERS[p]);

    const edited = withStarterHelpers({ "src/App.tsx": "x", ...OLD_STARTER, "src/lib/chain.ts": oldChain + "\nexport const extra = 1;\n" });
    expect(edited["src/lib/chain.ts"]).toContain("export const extra = 1;");
    expect(edited["src/lib/chain.ts"]).toContain("window as unknown as { ethereum");
    expect(checkApp({ ...starterFiles(), "src/App.tsx": "export default function App() { return <main>Hi</main>; }\n", "src/lib/chain.ts": edited["src/lib/chain.ts"] }).errors).toEqual([]);
  });

  it("moves untouched pre-D36 helpers to the project's chain, and updates only the network in a linked legacy wallet pair", () => {
    const mainnet = withStarterHelpers({ "src/App.tsx": "x", ...OLD_STARTER }, 42220);
    expect(mainnet["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(mainnet[WALLET_PATHS.wallet]).toContain("export const appChain = celo;");

    const editedHook = { ...OLD_STARTER, "src/lib/useWallet.ts": `${OLD_STARTER["src/lib/useWallet.ts"]}\nexport const customHook = true;\n` };
    const preserved = withStarterHelpers(editedHook, 42220);
    expect(preserved["src/lib/useWallet.ts"]).toContain("export const customHook = true;");
    expect(preserved["src/lib/chain.ts"]).toContain("export const chain = celo;");
    expect(preserved["src/lib/chain.ts"]).toContain("window as unknown as { ethereum");
  });

  it("never moves only part of an older project: the wallet shown and the wallet that sends must be the same", () => {
    const CHAIN = "src/lib/chain.ts";
    const HOOK = "src/lib/useWallet.ts";
    const BUTTON = "src/components/ConnectButton.tsx";
    const current = starterFiles();
    const old = { "src/App.tsx": "x", ...OLD_STARTER };

    // An edited chain.ts still sends through window.ethereum, so the hook and button stay with it.
    const chainEdited = withStarterHelpers({ ...old, [CHAIN]: OLD_STARTER[CHAIN] + "\nexport const extra = 1;\n" });
    expect(chainEdited[HOOK]).toBe(OLD_STARTER[HOOK]);
    expect(chainEdited[BUTTON]).toBe(OLD_STARTER[BUTTON]);

    // An edited useWallet.ts shows window.ethereum's account, so chain.ts stays too. The new button needs the new hook.
    const hookEdited = withStarterHelpers({ ...old, [HOOK]: OLD_STARTER[HOOK] + "\nexport const extra = 1;\n" });
    expect(hookEdited[CHAIN]).toBe(OLD_STARTER[CHAIN]);
    expect(hookEdited[BUTTON]).toBe(OLD_STARTER[BUTTON]);

    // An edited button only uses what the new hook still returns, so the other two can move.
    const buttonEdited = withStarterHelpers({ ...old, [BUTTON]: OLD_STARTER[BUTTON] + "\nexport const extra = 1;\n" });
    expect(buttonEdited[CHAIN]).toBe(current[CHAIN]);
    expect(buttonEdited[HOOK]).toBe(current[HOOK]);
    expect(buttonEdited[BUTTON]).toContain("export const extra = 1;");

    // Already on the layer and edited since: the remaining old copies can catch up.
    const onLayer = withStarterHelpers({ ...old, [CHAIN]: current[CHAIN] + "\nexport const extra = 1;\n" });
    expect(onLayer[HOOK]).toBe(current[HOOK]);
    expect(onLayer[BUTTON]).toBe(current[BUTTON]);

    // A project that deleted the hook has nothing showing a different wallet.
    const noHook: Record<string, string> = { ...old };
    delete noHook[HOOK];
    expect(withStarterHelpers(noHook)[CHAIN]).toBe(current[CHAIN]);
  });

  it("tells the builder not to read window.ethereum itself", () => {
    const issues = walletIssues({ "src/App.tsx": "const eth = (window as any).ethereum;\nexport default function App() { return null; }\n", "src/pages/Home.tsx": "await window.ethereum.request({ method: 'eth_accounts' })" });
    expect(issues.map((i) => [i.file, i.line])).toEqual([
      ["src/App.tsx", 1],
      ["src/pages/Home.tsx", 1],
    ]);
    expect(issues[0].message).toContain("walletProvider()");
    expect(checkApp({ ...starterFiles(), "src/App.tsx": "export default function App() { return <p>{String(!!window.ethereum)}</p>; }\n" }).ok).toBe(false);
  });

  it("tells the builder not to read OKX's window.okxwallet either (D92)", () => {
    const issues = walletIssues({ "src/App.tsx": "const okx = (window as any).okxwallet;\nexport default function App() { return null; }\n", "src/pages/Home.tsx": "await globalThis.okxwallet.request({ method: 'eth_requestAccounts' })", "src/lib/okx-notes.ts": "export const note = 'okxwallet is documented by OKX';\n" });
    expect(issues.map((i) => [i.file, i.line])).toEqual([
      ["src/App.tsx", 1],
      ["src/pages/Home.tsx", 1],
    ]);
    expect(issues[0].message).toMatch(/window\.okxwallet/);
    expect(issues[0].message).toContain("walletProvider()");
    // The layer itself reads it, so its own files are never flagged.
    expect(walletIssues(Object.fromEntries(LOCKED.map((p) => [p, WALLET_HELPERS[p]])))).toEqual([]);
  });

  it("isn't sent as context: the prompt documents it instead", () => {
    const picks = selectContext(starterFiles(), "Make the wallet connect button bigger").map((p) => p.path);
    for (const p of LOCKED) expect(picks).not.toContain(p);
    expect(picks).toContain("src/components/ConnectButton.tsx");
  });

  it("the prompt and guides point at the layer, not at window.ethereum", () => {
    const prompt = systemPrompt("build") + contextMessage({ files: starterFiles(), request: "add a connect button" });
    expect(prompt).toContain("src/lib/goodbuild/");
    expect(prompt).toContain("ConnectButton");
    expect(prompt).toMatch(/MiniPay/);
    expect(prompt).toMatch(/OKX Wallet/);
    const guides = loadGuides(["tokens", "ui-states"]).text;
    expect(guides).toContain("walletProvider()");
    expect(prompt + guides).not.toMatch(/window\.ethereum\.request/);
  });
});

describe("publishing", () => {
  const APP = `import { ConnectButton } from "./components/ConnectButton";
export default function App() { return <ConnectButton />; }
`;
  const build = (extra: Partial<Parameters<typeof buildPublishedApp>[0]> = {}, files: Record<string, string> = {}) =>
    buildPublishedApp({ files: { ...starterFiles(), "src/App.tsx": APP, ...files }, assets: [], title: "Wallet", hasUndeployedContracts: false, runtimeDir: "publish-runtime", ...extra });
  const text = (f: { bytes: Uint8Array }) => new TextDecoder().decode(f.bytes);

  it("with a project id: tells the page, and ships WalletConnect as a chunk loaded only on demand, without AppKit", async () => {
    const out = await build({ walletConnectProjectId: "abc123def456" });
    const page = text(out.find((f) => f.path === "index.html")!);
    expect(page).toContain('<meta name="goodbuild-walletconnect" content="abc123def456" />');
    const entry = out.find((f) => /^app\.[0-9a-f]{12}\.js$/.test(f.path))!;
    const wc = out.find((f) => f.path.endsWith(".js") && text(f).includes("display_uri"))!;
    expect(wc.path).toMatch(/^chunk\.[A-Z0-9]+\.js$/);
    expect(text(entry)).not.toContain("display_uri");
    // Loaded with import(), never statically.
    expect(text(entry)).toMatch(new RegExp(`import\\("\\./${wc.path.replace(/\./g, "\\.")}"\\)|import\\("\\./chunk`));
    const all = out.filter((f) => f.path.endsWith(".js")).map(text).join("\n");
    expect(all).toContain("WalletConnect's modal isn't included.");
    expect(all).not.toContain("w3m-modal"); // AppKit's web component
    expect(all).not.toContain("fonts.reown.com");
  }, 120_000);

  it("without a project id: no meta tag and no WalletConnect code, so only browser wallets and MiniPay", async () => {
    const out = await build();
    expect(text(out.find((f) => f.path === "index.html")!)).not.toContain("goodbuild-walletconnect");
    expect(out.some((f) => f.path.endsWith(".js") && text(f).includes("display_uri"))).toBe(false);
  }, 120_000);

  it("only GoodBuild's module can import the WalletConnect package, and the project can't swap its own in", async () => {
    const direct = `import { EthereumProvider } from "@walletconnect/ethereum-provider";\nexport default function App() { return <p>{String(EthereumProvider)}</p>; }\n`;
    await expect(build({ walletConnectProjectId: "abc123def456" }, { "src/App.tsx": direct })).rejects.toMatchObject({ details: [expect.stringContaining("isn't on the allowed package list")] });
    const out = await build({ walletConnectProjectId: "abc123def456" }, { [WALLETCONNECT_PATH]: "export const walletConnectBuiltIn = 'tampered';" });
    expect(out.some((f) => text(f).includes("tampered"))).toBe(false);
  }, 120_000);

  it("the CSP lets WalletConnect's Verify frame load and nothing else changes for scripts", () => {
    const csp = publishedHeaders("index.html", "text/html", 1)["Content-Security-Policy"];
    expect(csp).toContain("frame-src 'self' https://verify.walletconnect.org");
    expect(csp).toContain("script-src 'self';");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(csp).toContain("connect-src 'self' https: wss:");
  });
});

/** chain.ts, useWallet.ts and ConnectButton.tsx as every project before D36 had them. */
const OLD_STARTER: Record<string, string> = {
  "src/lib/chain.ts": `import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Abi,
  type Address,
  type EIP1193Provider,
} from "viem";
import { celo, celoSepolia } from "viem/chains";

/** Stage 1 apps run on Celo Sepolia (testnet). */
export const chain = celoSepolia;
export const chains = { [celoSepolia.id]: celoSepolia, [celo.id]: celo } as const;

export const publicClient = createPublicClient({ chain, transport: http() });

function injected(): EIP1193Provider | undefined {
  return (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
}

export async function connectWallet(): Promise<Address> {
  const provider = injected();
  if (!provider) throw new Error("No wallet found. Install MetaMask or open this app in MiniPay.");
  const [account] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  await ensureChain(provider);
  return account;
}

async function ensureChain(provider: EIP1193Provider) {
  const hex = "0x" + chain.id.toString(16);
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  } catch {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hex,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: [chain.rpcUrls.default.http[0]],
          blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : [],
        },
      ],
    });
  }
}

/** Send a contract write from the connected wallet and wait for the receipt. */
export async function writeContract(args: {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}) {
  const provider = injected();
  if (!provider) throw new Error("No wallet found.");
  const [account] = (await provider.request({ method: "eth_requestAccounts" })) as Address[];
  await ensureChain(provider);
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  const { request } = await publicClient.simulateContract({ ...args, account } as never);
  const hash = await wallet.writeContract(request as never);
  return publicClient.waitForTransactionReceipt({ hash });
}
`,
  "src/lib/useWallet.ts": `import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { connectWallet } from "./chain";

/** The connected account, a connect function, and any connection error. */
export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const eth = (window as unknown as { ethereum?: { request: (a: { method: string }) => Promise<unknown>; on?: (e: string, f: (a: Address[]) => void) => void } }).ethereum;
    eth?.request({ method: "eth_accounts" }).then((a) => setAccount(((a as Address[]) ?? [])[0] ?? null)).catch(() => {});
    eth?.on?.("accountsChanged", (a) => setAccount(a[0] ?? null));
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      setAccount(await connectWallet());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      setConnecting(false);
    }
  }, []);

  return { account, connect, connecting, error };
}
`,
  "src/components/ConnectButton.tsx": `import { Wallet } from "lucide-react";
import { Button } from "./ui/button";
import { useWallet } from "../lib/useWallet";
import { shortAddress } from "../lib/utils";

export function ConnectButton() {
  const { account, connect, connecting } = useWallet();
  if (account) return <Button variant="outline">{shortAddress(account)}</Button>;
  return (
    <Button onClick={connect} disabled={connecting}>
      <Wallet className="size-4" />
      {connecting ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
`,
};
