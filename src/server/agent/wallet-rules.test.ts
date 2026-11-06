// @vitest-environment node
import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { checkApp, pathProblem, walletIssues } from "./checks";
import { selectContext } from "./codebase";
import { contextMessage, systemPrompt } from "./prompt";
import { loadGuides } from "./guides";
import { starterFiles, WALLET_HELPERS, withStarterHelpers } from "./template";
import { Workspace } from "./workspace";
import { WALLET_PATHS } from "./wallet-template";
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
    expect(checkApp(files).errors).toEqual([]);
    expect(files["src/lib/chain.ts"]).toContain('from "./goodbuild/wallet"');
    expect(files["src/lib/db.ts"]).toContain('from "./goodbuild/wallet"');
    expect(files["src/lib/db.ts"]).not.toContain("ethereum");
    expect(files["src/lib/useDb.ts"]).not.toContain("ethereum");
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
    expect(checkApp({ ...starterFiles(), "src/lib/chain.ts": edited["src/lib/chain.ts"] }).errors).toEqual([]);
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
