/**
 * Starter files for every generated dApp (AI_AGENT.md §5, §6; D7).
 *
 * Runs in Sandpack's in-browser bundler, so it stays simple: React 18, TypeScript,
 * relative imports only, Tailwind via the browser build, and viem for chain access
 * (wagmi is heavy in the in-browser bundler; see P10). shadcn-style components are
 * pre-written so the model composes rather than invents.
 *
 * `src/contracts/` is platform-owned: after each successful compile GoodBuild writes
 * one module per contract (ABI now, addresses after deploy in M5). The agent can read
 * these files but not edit them, so the front end can't drift from the contract.
 */

export const PLATFORM_DIR = "src/contracts/";

/** npm packages the generated app may use. The agent can add only from this list. */
export const ALLOWED_DEPENDENCIES: Record<string, string> = {
  react: "18.3.1",
  "react-dom": "18.3.1",
  viem: "2.57.16",
  "lucide-react": "1.68.0",
  clsx: "2.1.1",
  "tailwind-merge": "3.7.0",
  "class-variance-authority": "0.7.1",
  // Optional, added on request via add_dependency:
  "date-fns": "4.1.0",
  "canvas-confetti": "1.9.3",
  "qrcode.react": "4.2.0",
};

export const BASE_DEPENDENCIES = ["react", "react-dom", "viem", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority"];

export function packageJson(deps: string[]): string {
  const dependencies = Object.fromEntries(
    [...new Set(deps)].filter((d) => d in ALLOWED_DEPENDENCIES).sort().map((d) => [d, ALLOWED_DEPENDENCIES[d]]),
  );
  return JSON.stringify({ name: "goodbuild-app", private: true, main: "/src/main.tsx", dependencies }, null, 2) + "\n";
}

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GoodBuild app</title>
    <style type="text/tailwindcss">
      @theme {
        --color-background: #ffffff;
        --color-foreground: #0f172a;
        --color-muted: #f1f5f9;
        --color-muted-foreground: #64748b;
        --color-border: #e2e8f0;
        --color-primary: #0f172a;
        --color-primary-foreground: #ffffff;
        --color-accent: #592e81;
        --color-success: #059669;
        --color-warning: #d97706;
        --color-danger: #dc2626;
        --radius-lg: 0.75rem;
        --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
      }
    </style>
  </head>
  <body class="bg-muted text-foreground antialiased">
    <div id="root"></div>
  </body>
</html>
`;

const MAIN = `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`;

const STYLES = `html, body, #root { min-height: 100%; }
body { margin: 0; }
`;

const APP = `import { ConnectButton } from "./components/ConnectButton";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card";

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
        <b>My dApp</b>
        <ConnectButton />
      </header>
      <main className="mx-auto max-w-3xl p-6">
        <Card>
          <CardHeader>
            <CardTitle>Getting ready</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">GoodBuild is writing your app.</CardContent>
        </Card>
      </main>
    </div>
  );
}
`;

const UTILS = `import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortAddress(address?: string) {
  return address ? address.slice(0, 6) + "…" + address.slice(-4) : "";
}
`;

const CHAIN = `import {
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
`;

const USE_WALLET = `import { useCallback, useEffect, useState } from "react";
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
`;

const CONTRACTS_INDEX = `// Platform-owned. GoodBuild writes one module per compiled contract next to this file
// (ABI after each build, addresses after you deploy). Don't edit by hand.
export {};
`;

const CONNECT_BUTTON = `import { Wallet } from "lucide-react";
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
`;

const BUTTON = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-border bg-background hover:bg-muted",
        ghost: "hover:bg-muted",
        accent: "bg-accent text-white hover:opacity-90",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs", lg: "h-11 px-6" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
`;

const CARD = `import * as React from "react";
import { cn } from "../../lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-background shadow-sm", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pb-2", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("font-semibold", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5 pt-2", className)} {...props} />;
}
`;

const INPUT = `import * as React from "react";
import { cn } from "../../lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("h-9 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-accent/30", className)}
      {...props}
    />
  );
}
`;

const LABEL = `import * as React from "react";
import { cn } from "../../lib/utils";

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium", className)} {...props} />;
}
`;

const BADGE = `import * as React from "react";
import { cn } from "../../lib/utils";

const tones = {
  default: "bg-muted text-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
};

export function Badge({ tone = "default", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...props} />;
}
`;

/** Files every project starts with (paths without a leading slash). */
export function starterFiles(): Record<string, string> {
  return {
    "package.json": packageJson(BASE_DEPENDENCIES),
    "public/index.html": INDEX_HTML,
    "src/main.tsx": MAIN,
    "src/styles.css": STYLES,
    "src/App.tsx": APP,
    "src/lib/utils.ts": UTILS,
    "src/lib/chain.ts": CHAIN,
    "src/lib/useWallet.ts": USE_WALLET,
    "src/contracts/index.ts": CONTRACTS_INDEX,
    "src/components/ConnectButton.tsx": CONNECT_BUTTON,
    "src/components/ui/button.tsx": BUTTON,
    "src/components/ui/card.tsx": CARD,
    "src/components/ui/input.tsx": INPUT,
    "src/components/ui/label.tsx": LABEL,
    "src/components/ui/badge.tsx": BADGE,
  };
}

/** Dependencies listed in a project's package.json. */
export function dependenciesOf(files: Record<string, string>): string[] {
  try {
    return Object.keys((JSON.parse(files["package.json"] ?? "{}") as { dependencies?: Record<string, string> }).dependencies ?? {});
  } catch {
    return [];
  }
}

/** Platform module for one compiled contract: the ABI and (after M5) deployed addresses. */
export function contractModule(name: string, abi: unknown, addresses: Record<number, string> = {}): string {
  return `// Platform-owned: written by GoodBuild from the compiled contract. Don't edit by hand.
import type { Address } from "viem";

export const ${name}Abi = ${JSON.stringify(abi, null, 2)} as const;

/** Deployed addresses by chain id. Empty until you deploy. */
export const ${name}Address: Partial<Record<number, Address>> = ${JSON.stringify(addresses, null, 2)};
`;
}

export function contractsIndex(names: string[]): string {
  if (!names.length) return CONTRACTS_INDEX;
  return (
    `// Platform-owned. One module per compiled contract. Don't edit by hand.\n` +
    names.sort().map((n) => `export * from "./${n}";`).join("\n") +
    "\n"
  );
}
