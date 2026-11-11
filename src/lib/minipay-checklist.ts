import type { CheckIssue } from "@/server/agent/checks";

/**
 * MiniPay's requirements (D74, D88), with no server code, so the builder's checks and the chat's
 * MiniPay guide read the same list.
 */

/** The project has the MiniPay kit on (its marker file, src/goodbuild.json, lists "mini-app"). */
export function hasMiniPayKit(files: Record<string, string>): boolean {
  try {
    const kits = (JSON.parse(files["src/goodbuild.json"] ?? "{}") as { kits?: unknown }).kits;
    return Array.isArray(kits) && kits.includes("mini-app");
  } catch {
    return false;
  }
}

export function miniAppChecks(files: Record<string, string>): CheckIssue[] {
  const issues: CheckIssue[] = [];
  for (const [file, content] of Object.entries(files)) {
    // src/game/leaderboard.ts signs in only outside MiniPay, and posts to the contract inside it (D92).
    if (!/^src\/.*\.(tsx?|jsx?)$/.test(file) || file.startsWith("src/lib/") || file.startsWith("src/minipay/") || file === "src/game/leaderboard.ts") continue;
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
    if (/target\s*=\s*\{?\s*["']_blank["']/.test(content)) {
      issues.push({ file, line: line(/target\s*=\s*\{?\s*["']_blank["']/), source: "guardrail", message: "MiniPay has no tabs, so a link that opens a new tab goes nowhere. Remove target=\"_blank\" and use an in-app route or a plain link." });
    }
    if (/\bparseEther\s*\(/.test(content) && /\b(USDT|USDC|USDm|USDM|dollar)/i.test(content)) {
      issues.push({ file, line: line(/\bparseEther\s*\(/), source: "guardrail", message: "USDT and USDC have 6 decimals, not 18. Use coinAmount(coin, text) from src/minipay/minipay.ts." });
    }
  }
  if (!Object.entries(files).some(([f, c]) => !f.startsWith("src/minipay/") && c.includes("<MiniFooter"))) {
    issues.push({ file: "src/App.tsx", source: "paths", message: "A MiniPay app needs MiniFooter (src/minipay/MiniFooter.tsx) at the bottom of its pages, with the About, How to use, Terms, Privacy and Support links." });
  }
  const outside = Object.entries(files).filter(([f]) => !f.startsWith("src/minipay/"));
  if (!outside.some(([, c]) => c.includes("INFO_ROUTES"))) {
    issues.push({ file: "src/App.tsx", source: "paths", message: "Add the kit's five pages to the route table inside the Layout route: INFO_ROUTES.map((r) => <Route key={r.path} path={r.path} element={<InfoPage kind={r.kind} />} />), imported from src/minipay/InfoPages." });
  }
  if (/name:\s*"My app"/.test(files["src/minipay/app.ts"] ?? "")) {
    issues.push({ file: "src/minipay/app.ts", source: "paths", message: "Fill in MINI_APP (name, tagline, publisher, how-to steps) so the About, Terms and Privacy pages describe this app." });
  }
  return issues;
}

/**
 * The MiniPay checklist (D88): every requirement from MiniPay's docs and listing, in one list. The
 * builder gets it in the guide; miniPayChecklist() says which are met in a project's files, so the
 * chat can show the owner what was built and what to try on a phone.
 */
export type ChecklistHow = "checked" | "phone" | "listing";
export interface ChecklistItem {
  id: string;
  /** What has to be true, in plain words for the owner. */
  label: string;
  /** "checked": GoodBuild reads the files. "phone": only trying it in MiniPay shows it. "listing": only for the listing form. */
  how: ChecklistHow;
}

export const MINIPAY_CHECKLIST: ChecklistItem[] = [
  { id: "auto-connect", label: "Connects to the wallet by itself, with no Connect button inside MiniPay", how: "checked" },
  { id: "no-sign-in", label: "Never asks for a signature to log in", how: "checked" },
  { id: "legacy-tx", label: "Payments are plain transactions with the network fee in dollar coins", how: "checked" },
  { id: "decimals", label: "Dollar amounts use each coin's own decimals (6 for USDT and USDC, 18 for USDm)", how: "checked" },
  { id: "add-cash", label: "Shows Add cash when the balance is too low", how: "checked" },
  { id: "no-new-tabs", label: "No link opens a new tab", how: "checked" },
  { id: "footer", label: "Footer with About, How to use, Terms, Privacy and Support, and the line that it isn't run by Opera or MiniPay", how: "checked" },
  { id: "app-info", label: "The About, Terms and Privacy pages describe this app", how: "checked" },
  { id: "phone-layout", label: "Fits a small phone (360 x 640), one column, buttons big enough for a thumb", how: "phone" },
  { id: "opens-in-minipay", label: "Opens and works from MiniPay's test page, on the test network", how: "phone" },
  { id: "verified", label: "Contracts verified on Celoscan, with one sample transaction", how: "listing" },
];

export type ChecklistStatus = "done" | "todo" | "not-needed" | "try-on-phone" | "for-listing";

/** Which checklist items a project's files meet. Items only a phone or the listing can show say so. */
export function miniPayChecklist(files: Record<string, string>): Array<ChecklistItem & { status: ChecklistStatus }> {
  const issues = miniAppChecks(files);
  const has = (re: RegExp) => issues.some((i) => re.test(i.message));
  const app = Object.entries(files).filter(([f]) => /^src\/.*\.(tsx?|jsx?)$/.test(f) && !f.startsWith("src/lib/") && !f.startsWith("src/minipay/"));
  const pays = app.some(([, c]) => /\b(sendCoin|coinAmount|writeContract)\b/.test(c));
  const readsEthereum = app.some(([, c]) => /window\.ethereum/.test(c));
  const status = (item: ChecklistItem): ChecklistStatus => {
    switch (item.id) {
      case "auto-connect":
        return readsEthereum ? "todo" : "done";
      case "no-sign-in":
        return has(/signature/) ? "todo" : "done";
      case "legacy-tx":
        return !pays ? "not-needed" : has(/legacy/) ? "todo" : "done";
      case "decimals":
        return !pays ? "not-needed" : has(/decimals/) ? "todo" : "done";
      case "add-cash":
        return !pays ? "not-needed" : app.some(([, c]) => c.includes("ADD_CASH_URL")) ? "done" : "todo";
      case "no-new-tabs":
        return has(/new tab/) ? "todo" : "done";
      case "footer":
        return has(/MiniFooter|route table/) ? "todo" : "done";
      case "app-info":
        return has(/Fill in MINI_APP/) ? "todo" : "done";
      default:
        return item.how === "phone" ? "try-on-phone" : "for-listing";
    }
  };
  return MINIPAY_CHECKLIST.map((item) => ({ ...item, status: status(item) }));
}

