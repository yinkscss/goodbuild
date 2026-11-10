import { STABLECOINS } from "@/config/stablecoins";

import type { CheckIssue } from "../checks";

import type { Kit } from "./registry";

/**
 * The MiniPay kit (D74): apps that work inside MiniPay, Opera's stablecoin wallet on phones.
 * MiniPay has no sign-in and no SDK. It puts a wallet in the page (`window.ethereum`, with
 * `isMiniPay` true) and connects on its own, which GoodBuild's wallet layer already handles. What
 * the kit adds is the rest of MiniPay's rules: stablecoin amounts and fees, no message signing,
 * a phone-only layout, plain wording and the footer its listing needs.
 */

const COINS = JSON.stringify(
  Object.fromEntries(Object.entries(STABLECOINS).map(([chainId, coins]) => [chainId, Object.fromEntries(Object.values(coins).map((c) => [c.symbol, { label: c.label, address: c.address, decimals: c.decimals, feeCurrency: c.feeCurrency }]))])),
  null,
  2,
);

const MINIPAY_TS = `import { erc20Abi, createWalletClient, custom, formatUnits, parseUnits, type Address } from "viem";

import { chain, connectWallet, publicClient, walletProvider } from "../lib/chain";

/** The dollar coins MiniPay holds, per network. "USDM" is shown to people as USDm. */
const COINS = ${COINS} as const;
export type Coin = "USDT" | "USDC" | "USDM";

export function coinInfo(coin: Coin) {
  const table = COINS[String(chain.id) as keyof typeof COINS];
  return table[coin];
}

/** True inside MiniPay. Everywhere else the app works the same, with the usual wallet list. */
export function inMiniPay(): boolean {
  return (walletProvider() as { isMiniPay?: boolean } | null)?.isMiniPay === true;
}

/** How much of a coin this wallet has, as a number to show ("12.5"). */
export async function coinBalance(coin: Coin, owner: Address): Promise<string> {
  const c = coinInfo(coin);
  const raw = (await publicClient.readContract({ address: c.address as Address, abi: erc20Abi, functionName: "balanceOf", args: [owner] } as never)) as bigint;
  return formatUnits(raw, c.decimals);
}

/** An amount people typed ("2.50") as the coin's smallest units. Use this, never a hard-coded 1e18. */
export function coinAmount(coin: Coin, text: string): bigint {
  return parseUnits(text.trim() as \`\${number}\`, coinInfo(coin).decimals);
}

/**
 * Send a coin from the connected wallet. The network fee is paid in the same coin, and the
 * transaction is a plain (legacy) one, which is what MiniPay accepts. Waits for the receipt.
 */
export async function sendCoin(args: { coin: Coin; to: Address; amount: string }) {
  const account = await connectWallet();
  const c = coinInfo(args.coin);
  const wallet = createWalletClient({ account, chain, transport: custom(walletProvider()!) });
  const hash = await wallet.writeContract({
    address: c.address as Address,
    abi: erc20Abi,
    functionName: "transfer",
    args: [args.to, coinAmount(args.coin, args.amount)],
    feeCurrency: c.feeCurrency as Address,
    type: "legacy",
  } as never);
  return publicClient.waitForTransactionReceipt({ hash });
}

/** MiniPay's own screen for adding cash, for when someone's balance is too low. */
export const ADD_CASH_URL = "https://link.minipay.xyz/add_cash";

/** A sentence for a failed payment: never the raw error. */
export function paymentProblem(error: unknown): string {
  const text = String((error as { shortMessage?: string; message?: string })?.shortMessage ?? (error as Error)?.message ?? error).toLowerCase();
  if (/user (rejected|denied)|rejected the request|cancel/.test(text)) return "You cancelled the payment. Nothing was sent.";
  if (/insufficient|exceeds balance|transfer amount exceeds/.test(text)) return "Not enough money for this. Add cash and try again.";
  return "The payment didn't go through. Nothing was taken. Please try again.";
}
`;

const FOOTER_TSX = `import type { ReactNode } from "react";

export interface FooterLinks {
  about: string;
  howToUse: string;
  terms: string;
  privacy: string;
  support: string;
}

/**
 * The footer MiniPay's listing asks for: About, How to use, Terms, Privacy and Support, plus the
 * line that says the app isn't run by Opera or MiniPay. Pass the app's own pages as links.
 */
export function MiniFooter({ links, children }: { links: FooterLinks; children?: ReactNode }) {
  const items: Array<[string, string]> = [
    ["About", links.about],
    ["How to use", links.howToUse],
    ["Terms", links.terms],
    ["Privacy", links.privacy],
    ["Support", links.support],
  ];
  return (
    <footer className="mt-8 border-t px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
      <nav className="flex flex-wrap justify-center gap-x-4">
        {items.map(([label, href]) => (
          <a key={label} href={href} className="inline-flex min-h-11 items-center underline-offset-2 hover:underline">
            {label}
          </a>
        ))}
      </nav>
      <p className="mt-2">This app is not operated by Opera or MiniPay.</p>
    </footer>
  );
}
`;

const GUIDE = `MiniPay apps. MiniPay is Opera's stablecoin wallet on phones. There is no sign-in and no SDK: it connects the wallet by itself when the page loads (GoodBuild's wallet layer already does this), and the person pays in dollar coins. The kit's files are in src/minipay/: use them, don't rewrite them.
- Phone only. Design for 360 x 640 and up, one column, no horizontal scroll, no hover-only controls. Every button and link is at least 44px tall (min-h-11).
- Never show a "Connect wallet" button or a wallet list. Inside MiniPay the wallet is already connected: show the app straight away, and show the person's balance where it matters. Outside MiniPay (a desktop check, the preview) the normal ConnectButton still works, so keep it as the fallback for when there is no wallet yet.
- Never ask for a signature to log in. MiniPay forbids it. Don't use signMessage, personal_sign or the app-data sign-in (signIn / useAuth) in a MiniPay app. The wallet address is the person's identity: keep anything personal on the contract, or in this device's storage.
- Money is dollars. People see USDT, USDC and USDm, written as amounts like "$2.50", never CELO, never "gas". The network cost is called "Network fee". Words: "Add cash" and "Withdraw", not "deposit tokens" or "bridge".
- Amounts: use coinAmount(coin, "2.50") and coinBalance(coin, address). USDT and USDC have 6 decimals and USDm has 18, so never write 1e18 or parseEther for a dollar amount. A contract that takes stablecoins takes the token address (see coinInfo(coin).address) and pulls it with SafeERC20: approve first, then the contract's own call. Check the allowance before asking for an approval, and show the two steps as one "Pay" button with progress.
- To send a coin, call sendCoin({ coin, to, amount }). It pays the fee in that coin and sends a plain transaction. For a contract call, pass feeCurrency (coinInfo(coin).feeCurrency) and type: "legacy" in the same way, and don't set maxFeePerGas or maxPriorityFeePerGas.
- A payment has four states, each with its own plain words: waiting for the person to confirm, sending, done (what happened, with what it cost), failed (paymentProblem(error), then a button to try again). If the balance is too low, show an "Add cash" link to ADD_CASH_URL instead of letting the payment fail.
- Don't show raw 0x addresses. Show a name, a short label or "Your account". Don't offer a box to type any address to withdraw to.
- Put MiniFooter at the bottom of every page, with the app's own About, How to use, Terms, Privacy and Support pages (write real short pages for these, reachable by routes in the app).
- Only the app's own pinned packages. MiniPay doesn't support ethers: use viem.
- When the person wants it listed in MiniPay: the listing form (developer.minipay.to/mini-app-listing) needs a name, a one-line tagline, publisher, support link, Terms and Privacy links, a category, the app's address and a 512 x 512 icon; the contracts must be verified on Celoscan with a sample transaction. Tell them this once the app is published, in plain words.`;

/** Words that mean this kind of app. */
const KEYWORDS = /\b(mini ?pay|mini ?app|opera mini|opera wallet|stablecoin (?:app|wallet|payments?)|pay (?:with|in) (?:usdt|usdc|stablecoins?)|usdt|usdc|usdm)\b/i;

export function miniAppChecks(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!/^src\/.*\.(tsx?|jsx?)$/.test(file) || file.startsWith("src/lib/") || file.startsWith("src/minipay/")) continue;
    const line = (re: RegExp) => content.slice(0, content.search(re)).split("\n").length;
    if (/\b(signMessage|personal_sign|signTypedData|eth_sign)\b/.test(content)) {
      issues.push({ file, line: line(/\b(signMessage|personal_sign|signTypedData|eth_sign)\b/), source: "guardrail", message: "MiniPay doesn't allow asking for a signature to log in. Use the wallet address as the person's identity and remove the signing." });
    }
    if (/\bsignIn\s*\(/.test(content) && /from ["'][^"']*(db|useDb|useAuth)["']/.test(content)) {
      issues.push({ file, line: line(/\bsignIn\s*\(/), source: "guardrail", message: "App-data sign-in needs a signature, which MiniPay doesn't allow. Keep this on the contract or in this device's storage." });
    }
    if (/\b(maxFeePerGas|maxPriorityFeePerGas)\b/.test(content)) {
      issues.push({ file, line: line(/\b(maxFeePerGas|maxPriorityFeePerGas)\b/), source: "guardrail", message: "MiniPay takes plain (legacy) transactions. Remove maxFeePerGas and maxPriorityFeePerGas, and use sendCoin or type: \"legacy\" with feeCurrency." });
    }
    if (/\bparseEther\s*\(/.test(content) && /\b(USDT|USDC|USDm|USDM|dollar)/i.test(content)) {
      issues.push({ file, line: line(/\bparseEther\s*\(/), source: "guardrail", message: "USDT and USDC have 6 decimals, not 18. Use coinAmount(coin, text) from src/minipay/minipay.ts." });
    }
  }
  if (!Object.entries(files).some(([f, c]) => !f.startsWith("src/minipay/") && c.includes("<MiniFooter"))) {
    issues.push({ file: "src/App.tsx", source: "paths", message: "A MiniPay app needs MiniFooter (src/minipay/MiniFooter.tsx) at the bottom of its pages, with the About, How to use, Terms, Privacy and Support links." });
  }
  return issues;
}

export const miniApp: Kit = {
  id: "mini-app",
  title: "MiniPay apps",
  when: "an app people will open inside MiniPay (Opera's phone wallet) or that takes payments in dollar stablecoins (USDT, USDC, USDm)",
  keywords: KEYWORDS,
  packages: {},
  files: {
    "src/minipay/minipay.ts": MINIPAY_TS,
    "src/minipay/MiniFooter.tsx": FOOTER_TSX,
  },
  guide: GUIDE,
  checks: miniAppChecks,
};
