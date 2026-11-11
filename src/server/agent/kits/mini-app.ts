import { STABLECOINS } from "@/config/stablecoins";

import { MINIPAY_CHECKLIST, miniAppChecks } from "@/lib/minipay-checklist";

import type { Kit } from "./registry";

export { MINIPAY_CHECKLIST, miniAppChecks, miniPayChecklist } from "@/lib/minipay-checklist";

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

const APP_TS = `/**
 * Fill this in once for the app. The About, How to use, Terms, Privacy and Support pages
 * (InfoPages.tsx) are written from it, so they stay true to what the app does.
 */
export const MINI_APP = {
  name: "My app",
  tagline: "What this app does, in one line.",
  publisher: "Your name or team",
  /** Where people write for help. Leave empty if there is no email yet. */
  supportEmail: "",
  /** Three or four short steps, in plain words. */
  howTo: ["Open the app in MiniPay.", "Choose what you want.", "Confirm the payment in your wallet."],
  /** Anything the app keeps about people besides their wallet address, e.g. "Your orders are kept on this phone." Empty if nothing. */
  keeps: "",
};
`;

const INFO_TSX = `import type { ReactNode } from "react";

import { MINI_APP } from "./app";

export type InfoKind = "about" | "how" | "terms" | "privacy" | "support";

/** Route paths for the five pages (HashRouter). Add them inside the Layout route: INFO_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<InfoPage kind={r.kind} />} />) */
export const INFO_ROUTES: Array<{ path: string; kind: InfoKind }> = [
  { path: "about", kind: "about" },
  { path: "how-to-use", kind: "how" },
  { path: "terms", kind: "terms" },
  { path: "privacy", kind: "privacy" },
  { path: "support", kind: "support" },
];

/** What MiniFooter links to when it isn't given links of its own. */
export const MINI_LINKS = { about: "#/about", howToUse: "#/how-to-use", terms: "#/terms", privacy: "#/privacy", support: "#/support" };

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-6">
      <a href="#/" className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline-offset-2 hover:underline">
        Back
      </a>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="space-y-3 leading-relaxed text-muted-foreground">{children}</div>
    </main>
  );
}

export function InfoPage({ kind }: { kind: InfoKind }) {
  const a = MINI_APP;
  if (kind === "about") {
    return (
      <Page title={"About " + a.name}>
        <p>{a.tagline}</p>
        <p>{a.name} is made by {a.publisher}. It works inside MiniPay and takes payments in dollar coins.</p>
      </Page>
    );
  }
  if (kind === "how") {
    return (
      <Page title="How to use">
        <ol className="list-decimal space-y-2 pl-5">
          {a.howTo.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p>Need money in your wallet first? Use Add cash in MiniPay.</p>
      </Page>
    );
  }
  if (kind === "terms") {
    return (
      <Page title="Terms">
        <p>{a.name} is run by {a.publisher}. It is not run by Opera or MiniPay.</p>
        <p>Payments are sent from your own MiniPay wallet. You confirm every payment yourself, and this app cannot take money from your wallet without it.</p>
        <p>A payment that has gone through cannot be undone by this app. Check the amount before you confirm.</p>
        <p>The app is offered as it is, and it may change or stop. These are plain-words terms, not legal advice.</p>
      </Page>
    );
  }
  if (kind === "privacy") {
    return (
      <Page title="Privacy">
        <p>{a.name} does not ask for your name, email or phone number.</p>
        <p>Your wallet address and your payments are public on the blockchain. Nobody, including us, can remove them.</p>
        {a.keeps ? <p>{a.keeps}</p> : <p>The app keeps nothing else about you.</p>}
      </Page>
    );
  }
  return (
    <Page title="Support">
      {a.supportEmail ? (
        <p>
          Write to <a className="underline" href={"mailto:" + a.supportEmail}>{a.supportEmail}</a> and say what happened and when.
        </p>
      ) : (
        <p>Message {a.publisher} where you found this app, and say what happened and when.</p>
      )}
      <p>A payment that failed does not take your money. If one looks stuck, check your MiniPay history first.</p>
    </Page>
  );
}
`;

const FOOTER_TSX = `import type { ReactNode } from "react";

import { MINI_LINKS } from "./InfoPages";

export interface FooterLinks {
  about: string;
  howToUse: string;
  terms: string;
  privacy: string;
  support: string;
}

/**
 * The footer MiniPay's listing asks for: About, How to use, Terms, Privacy and Support, plus the
 * line that says the app isn't run by Opera or MiniPay. With no links it points at the kit's own five pages.
 */
export function MiniFooter({ links = MINI_LINKS, children }: { links?: FooterLinks; children?: ReactNode }) {
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

const CHECKLIST_TEXT = MINIPAY_CHECKLIST.map((i) => `  - ${i.label}${i.how === "checked" ? " (checked)" : i.how === "phone" ? " (on a phone)" : " (for the listing)"}`).join("\n");

const GUIDE = `MiniPay apps. MiniPay is Opera's stablecoin wallet on phones. There is no sign-in and no SDK: it connects the wallet by itself when the page loads (GoodBuild's wallet layer already does this), and the person pays in dollar coins. The kit's files are in src/minipay/: use them, don't rewrite them.
- Phone only. Design for 360 x 640 and up, one column, no horizontal scroll, no hover-only controls. Every button and link is at least 44px tall (min-h-11).
- Never show a "Connect wallet" button or a wallet list. Inside MiniPay the wallet is already connected: show the app straight away, and show the person's balance where it matters. Outside MiniPay (a desktop check, the preview) the normal ConnectButton still works, so keep it as the fallback for when there is no wallet yet.
- Never ask for a signature to log in. MiniPay forbids it. Don't use signMessage, personal_sign or the app-data sign-in (signIn / useAuth) in a MiniPay app. The wallet address is the person's identity: keep anything personal on the contract, or in this device's storage.
- Money is dollars. People see USDT, USDC and USDm, written as amounts like "$2.50", never CELO, never "gas". The network cost is called "Network fee". Words: "Add cash" and "Withdraw", not "deposit tokens" or "bridge".
- Amounts: use coinAmount(coin, "2.50") and coinBalance(coin, address). USDT and USDC have 6 decimals and USDm has 18, so never write 1e18 or parseEther for a dollar amount. A contract that takes stablecoins takes the token address (see coinInfo(coin).address) and pulls it with SafeERC20: approve first, then the contract's own call. Check the allowance before asking for an approval, and show the two steps as one "Pay" button with progress.
- To send a coin, call sendCoin({ coin, to, amount }). It pays the fee in that coin and sends a plain transaction. For a contract call, pass feeCurrency (coinInfo(coin).feeCurrency) and type: "legacy" in the same way, and don't set maxFeePerGas or maxPriorityFeePerGas.
- A payment has four states, each with its own plain words: waiting for the person to confirm, sending, done (what happened, with what it cost), failed (paymentProblem(error), then a button to try again). If the balance is too low, show an "Add cash" link to ADD_CASH_URL instead of letting the payment fail.
- Don't show raw 0x addresses. Show a name, a short label or "Your account". Don't offer a box to type any address to withdraw to.
- The About, How to use, Terms, Privacy and Support pages are already written: src/minipay/InfoPages.tsx. Don't write them yourself and don't load the content-pages guide for them. Do three small things: (1) fill in MINI_APP in src/minipay/app.ts once (name, tagline, publisher, support email, how-to steps, anything the app keeps); (2) add the five routes inside the Layout route: INFO_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<InfoPage kind={r.kind} />} />); (3) put <MiniFooter /> at the bottom of Layout, so every page has it. In your reply, tell the owner the Terms and Privacy pages are plain-words starters to read before listing.
- If a page has a bar fixed to the bottom (a cart or checkout bar), give the page bottom padding at least as tall as the bar, so the footer links are never hidden behind it.
- Links never open a new tab. MiniPay has no tabs, so target="_blank" goes nowhere: use in-app routes (#/...) and plain links.
- A game: the play area fills the phone and is played with the thumb, and MiniFooter goes on the start screen (the Layout under it), never over the play area. A game with no money in it needs none of the payment parts: no balance, no Pay button, no Add cash.
- Before you finish, go through the MiniPay checklist below. GoodBuild checks the items marked (checked) itself and lists the rest for the owner to try on a phone, so build every one:
${CHECKLIST_TEXT}
- Don't spend rounds on anything the kit already has. Write the app's own screens and, if there is one, its contract; write several files in the same round.
- Only the app's own pinned packages. MiniPay doesn't support ethers: use viem.
- When the person wants it listed in MiniPay: the listing form (developer.minipay.to/mini-app-listing) needs a name, a one-line tagline, publisher, support link, Terms and Privacy links, a category, the app's address and a 512 x 512 icon; the contracts must be verified on Celoscan with a sample transaction. Tell them this once the app is published, in plain words.`;

/** Words that mean this kind of app. */
const KEYWORDS = /\b(mini ?pay|mini ?app|opera mini|opera wallet|stablecoin (?:app|wallet|payments?)|pay (?:with|in) (?:usdt|usdc|stablecoins?)|usdt|usdc|usdm)\b/i;

export const miniApp: Kit = {
  id: "mini-app",
  title: "MiniPay apps",
  when: "an app people will open inside MiniPay (Opera's phone wallet) or that takes payments in dollar stablecoins (USDT, USDC, USDm)",
  keywords: KEYWORDS,
  packages: {},
  files: {
    "src/minipay/minipay.ts": MINIPAY_TS,
    "src/minipay/app.ts": APP_TS,
    "src/minipay/InfoPages.tsx": INFO_TSX,
    "src/minipay/MiniFooter.tsx": FOOTER_TSX,
  },
  guide: GUIDE,
  checks: miniAppChecks,
};
