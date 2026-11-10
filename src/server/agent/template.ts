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

import { NETWORKS } from "@/config/networks";
import { chainSourceFor, CONNECT_BUTTON, USE_WALLET, walletHelpersFor, withCurrentWalletHelpers } from "./wallet-template";

export { WALLET_DIR, WALLET_HELPERS, withCurrentWalletHelpers } from "./wallet-template";

import { allKitPackages } from "./kits/registry";

export const PLATFORM_DIR = "src/contracts/";

/** npm packages the generated app may use. The agent can add only from this list. */
/** The packages every project may use, whatever kits it has on. */
export const BASE_ALLOWED_DEPENDENCIES: Record<string, string> = {
  react: "18.3.1",
  "react-dom": "18.3.1",
  viem: "2.57.16",
  "lucide-react": "1.68.0",
  clsx: "2.1.1",
  "tailwind-merge": "3.7.0",
  "class-variance-authority": "0.7.1",
  "react-router-dom": "6.30.6",
  // Optional, added on request via add_dependency:
  "date-fns": "4.1.0",
  "canvas-confetti": "1.9.3",
  "qrcode.react": "4.2.0",
};

/**
 * Every package a generated app can have: the base list plus what the kits bring (D71). This is what
 * publishing bundles from and what publish-runtime installs. What one project may add is narrower:
 * packagesFor() in kits/index.ts.
 */
export const ALLOWED_DEPENDENCIES: Record<string, string> = { ...BASE_ALLOWED_DEPENDENCIES, ...allKitPackages() };

/**
 * Packages only GoodBuild's own code uses: the WalletConnect module publishing swaps into
 * src/lib/goodbuild/walletConnect.tsx (D36). The builder can't import or add them.
 */
export const PLATFORM_DEPENDENCIES: Record<string, string> = {
  "@walletconnect/ethereum-provider": "2.26.0",
  // Types for three.js, so the type check can read it (D77). Only the kit's three is importable.
  "@types/three": "0.187.0",
};

export const BASE_DEPENDENCIES = ["react", "react-dom", "react-router-dom", "viem", "lucide-react", "clsx", "tailwind-merge", "class-variance-authority"];

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
        --color-card: #ffffff;
        --color-border: #e2e8f0;
        --color-ring: #592e81;
        --color-primary: #0f172a;
        --color-primary-foreground: #ffffff;
        --color-accent: #592e81;
        --color-accent-foreground: #ffffff;
        --color-success: #059669;
        --color-warning: #d97706;
        --color-danger: #dc2626;
        --radius-lg: 0.75rem;
        --font-sans: Inter, ui-sans-serif, system-ui, sans-serif;
        --font-display: Inter, ui-sans-serif, system-ui, sans-serif;
      }
      @layer base {
        body {
          @apply bg-muted text-foreground;
        }
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

/** The sentence on the starter page. A build that still contains it has not written the app. */
export const STARTER_APP_MARK = "Your app is being written. It will appear here in a moment.";

export function isStarterApp(source: string | undefined): boolean {
  return !!source && source.includes(STARTER_APP_MARK);
}

// Deliberately layout-free: a placeholder the agent replaces, so its first build designs a
// page for the request instead of copying a stock header-plus-card shell.
const APP = `export default function App() {
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <p className="text-sm text-muted-foreground">${STARTER_APP_MARK}</p>
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



const FORMAT = `/** Token amount (smallest unit) to a short human string, e.g. 1234.5 G$. */
export function formatAmount(value: bigint | undefined, decimals = 18, maxFraction = 2) {
  if (value === undefined) return "…";
  const zero = BigInt(0);
  const neg = value < zero;
  const abs = neg ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return (neg ? "-" : "") + whole.toLocaleString("en-US") + (frac ? "." + frac : "");
}

/** Readable message from a wallet or contract error (user rejections, reverts, RPC errors). */
export function errorMessage(e: unknown): string {
  const err = e as { shortMessage?: string; message?: string; code?: number } | undefined;
  if (err?.code === 4001 || /user (rejected|denied)/i.test(err?.message ?? "")) return "You cancelled the request in your wallet.";
  const text = err?.shortMessage ?? err?.message ?? "Something went wrong.";
  return text.split("\\n")[0];
}
`;

const HOOKS = `import { useCallback, useEffect, useRef, useState } from "react";
import type { TransactionReceipt } from "viem";
import { errorMessage } from "./format";

/**
 * Run an async read (usually publicClient.readContract) with loading and error state.
 * Pass enabled=false to skip it (e.g. no wallet or no deployed address yet).
 *   const tips = useRead(() => publicClient.readContract({ address, abi, functionName: "totalTips" }), [address], !!address);
 */
export function useRead<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const refresh = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setData(await fnRef.current());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}

/**
 * Track one wallet transaction: pending while the wallet signs and the chain confirms,
 * then success or a readable error.
 *   const tx = useTx();
 *   await tx.run(() => writeContract({ ... }));  // returns the receipt, or undefined on error
 */
export function useTx() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<TransactionReceipt | null>(null);

  const run = useCallback(async (send: () => Promise<TransactionReceipt>) => {
    setPending(true);
    setError(null);
    setReceipt(null);
    try {
      const r = await send();
      if (r.status !== "success") throw new Error("The transaction was reverted.");
      setReceipt(r);
      return r;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { run, pending, error, receipt, reset: () => (setError(null), setReceipt(null)) };
}
`;

const TOKENS = `import { erc20Abi } from "viem";

/** ERC-677: send tokens and call the receiver's onTokenTransfer(from, amount, data) in one transaction. G$ supports it. */
export const erc677Abi = [
  {
    type: "function",
    name: "transferAndCall",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** ABI for the G$ token: standard ERC-20 plus transferAndCall. */
export const gdTokenAbi = [...erc20Abi, ...erc677Abi] as const;
`;

const DATA_RULES = `{
  "collections": {}
}
`;

/** Written by GoodBuild. Talks to the published app's own host, and to a stand-in in the preview. */
const DB = `import { createWalletClient, custom, getAddress } from "viem";
import { appChain as chain, connectWallet, hasWallet, walletProvider } from "./goodbuild/wallet";
import rules from "./dataRules.json";

/**
 * Saved data for this app, kept on GoodBuild's servers once the app is published. Visitors sign in
 * with their wallet (a signature, no transaction and no gas). src/lib/dataRules.json says, for each
 * collection, who can add, read and delete records, which fields everyone sees, and which values
 * must be unique. A collection with "create": "anyone" takes records from visitors who never sign in.
 * In the preview nothing reaches a server: records stay in this browser, sign-in needs no signature,
 * and you are treated as the app's owner so you can see what visitors would send you.
 */
export interface DbRecord<T = unknown> {
  key: string;
  /** Who wrote it: a wallet, or "anon:..." for a visitor who didn't sign in. Null when you only see its public fields. */
  owner: string | null;
  value: T;
  public: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DbPage<T = unknown> {
  records: DbRecord<T>[];
  nextCursor: string | null;
}

export class DbError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const BASE = "/__gb/data/v1";
const clientId = typeof document === "undefined" ? null : document.querySelector('meta[name="goodbuild-data"]')?.getAttribute("content") ?? null;

/** True in the GoodBuild preview, where saved data stays in this browser. */
export const isPreview = !clientId;

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      ...init,
      headers: { "x-gb-client": clientId ?? "", ...(init.body ? { "content-type": "application/json" } : {}) },
    });
  } catch {
    throw new DbError("network", "Couldn't reach the server. Check your connection and try again.");
  }
  const body = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
  if (!res.ok) throw new DbError(body?.error ?? "error", body?.message ?? "Something went wrong. Try again.", res.status);
  return body as T;
}

function signInMessage(a: { domain: string; address: string; uri: string; nonce: string }) {
  return [
    a.domain + " wants you to sign in with your Ethereum account:",
    a.address,
    "",
    "Sign in to this app. This isn't a transaction and costs no gas.",
    "",
    "URI: " + a.uri,
    "Version: 1",
    "Chain ID: " + chain.id,
    "Nonce: " + a.nonce,
    "Issued At: " + new Date().toISOString(),
  ].join("\\n");
}

// --- The preview's stand-in: same behaviour, in this browser only -------------------------------

type Stored = DbRecord & { collection: string };
const PREVIEW_KEY = "goodbuild-preview-data";
const PREVIEW_VISITOR = "0x000000000000000000000000000000000000dead";
let previewWallet: string | null = null;
const previewRecords = (): Stored[] => {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_KEY) ?? "[]") as Stored[];
  } catch {
    return [];
  }
};
const savePreview = (records: Stored[]) => {
  try {
    localStorage.setItem(PREVIEW_KEY, JSON.stringify(records));
  } catch {
    // Private windows may refuse. Nothing else depends on it.
  }
};
type Rule = { create: string; read: string[]; public: string[]; fields: Record<string, string> | null; unique: string[] };
/** The same reading of dataRules.json as the server's, for the preview. */
function ruleOf(name: string): Rule {
  const raw = (rules as { collections?: Record<string, unknown> }).collections?.[name];
  const base: Rule = { create: "signed-in", read: ["writer"], public: [], fields: null, unique: [] };
  if (raw === "public-read") return { ...base, read: ["anyone"] };
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<Record<keyof Rule, unknown>>;
  const arr = (v: unknown, d: string[]) => (typeof v === "string" ? [v] : Array.isArray(v) ? (v as string[]) : d);
  return { create: typeof r.create === "string" ? r.create : "signed-in", read: arr(r.read, ["writer"]), public: arr(r.public, []), fields: (r.fields as Record<string, string>) ?? null, unique: arr(r.unique, []) };
}
const PREVIEW_ANON = "anon:00000000-0000-4000-8000-000000000000";
const PREVIEW_EMAIL_ID = "email:00000000-0000-4000-8000-000000000001";
let previewEmail: string | null = null;
/** Who the preview's visitor is: their wallet, their email id, or nobody. */
const previewSubject = () => previewWallet ?? (previewEmail ? PREVIEW_EMAIL_ID : null);
const emailOffered = () => (rules as { signIn?: { email?: unknown } }).signIn?.email === true;

/** The default note never replaces a more specific one, such as the email sign-in note. */
function showPreviewNote(special?: string) {
  const text = special ?? "Preview: saved data stays in this browser. It's stored for real once you publish.";
  const existing = document.querySelector("[data-goodbuild-preview-note]");
  if (existing) {
    if (special) existing.textContent = special;
    return;
  }
  const note = document.createElement("div");
  note.setAttribute("data-goodbuild-preview-note", "");
  note.setAttribute("role", "note");
  note.textContent = text;
  note.style.cssText = "position:fixed;left:8px;bottom:8px;z-index:9999;max-width:calc(100vw - 16px);padding:6px 10px;border-radius:8px;font:500 12px/1.4 system-ui,sans-serif;background:#1a0d26;color:#fff";
  document.body.appendChild(note);
}

function requirePreviewWallet(): string {
  if (!previewWallet) throw new DbError("unauthenticated", "Connect your wallet and sign in first.", 401);
  return previewWallet;
}

function previewPut<T>(collection: string, key: string, value: T): DbRecord<T> {
  const rule = ruleOf(collection);
  const owner = previewSubject() ?? (rule.create === "anyone" ? PREVIEW_ANON : requirePreviewWallet());
  showPreviewNote();
  const now = new Date().toISOString();
  const all = previewRecords();
  const found = all.find((r) => r.key === key && r.owner === owner && r.collection === collection);
  const v = value as unknown as Record<string, unknown>;
  if (rule.fields && v && typeof v === "object") {
    const extra = Object.keys(v).filter((f) => !(f in rule.fields!));
    if (extra.length) throw new DbError("invalid_value", "These fields aren't part of this collection: " + extra.join(", ") + ".", 400);
  }
  if (rule.unique.length && all.some((r) => r.collection === collection && r !== found && rule.unique.every((f) => JSON.stringify((r.value as Record<string, unknown>)?.[f]) === JSON.stringify(v?.[f])))) {
    throw new DbError("duplicate", "That " + rule.unique.join(" and ") + " is already taken.", 409);
  }
  const record: DbRecord<T> & { collection: string } = { key, owner, value, public: rule.read.includes("anyone"), createdAt: found?.createdAt ?? now, updatedAt: now, collection };
  savePreview([record, ...all.filter((r) => r !== found)]);
  return record;
}

/** In the preview you are the owner, so you see what the owner would. */
function previewVisible(collection: string, owner?: string): DbRecord[] {
  const rule = ruleOf(collection);
  return previewRecords()
    .filter((r) => r.collection === collection)
    .map((r) => (rule.read.some((x) => x === "anyone" || x === "owner" || (x === "signed-in" && previewSubject()) || (x === "writer" && r.owner === (previewSubject() ?? PREVIEW_ANON))) ? r : null))
    .filter((r): r is Stored => r !== null && (!owner || r.owner === owner.toLowerCase()));
}

// --- The API ------------------------------------------------------------------------------------

export interface DbSessionInfo {
  /** The signed-in wallet, or null (also null for someone signed in by email). */
  wallet: string | null;
  /** The address of someone signed in by email, or null. Only they ever see it. */
  email: string | null;
  signedIn: boolean;
  /** The app's owner is signed in (always true in the preview). */
  owner: boolean;
  /** This app offers email sign-in ("signIn": {"email": true} in dataRules.json). */
  emailSignIn: boolean;
}

/** Everything about who is signed in to this app, in one request. */
export async function sessionInfo(): Promise<DbSessionInfo> {
  if (isPreview) {
    const subject = previewSubject();
    return { wallet: previewWallet, email: previewWallet ? null : previewEmail, signedIn: Boolean(subject), owner: true, emailSignIn: emailOffered() };
  }
  const s = await api<Partial<DbSessionInfo>>("/session");
  return { wallet: s.wallet ?? null, email: s.email ?? null, signedIn: Boolean(s.signedIn ?? s.wallet), owner: s.owner === true, emailSignIn: s.emailSignIn === true };
}

/**
 * Email sign-in, step 1: send a 6-digit code to this address. Only in apps whose dataRules.json has
 * "signIn": {"email": true}. Throws with a message you can show (a wrong address, too many codes).
 */
export async function sendEmailCode(email: string): Promise<void> {
  if (isPreview) {
    showPreviewNote("Preview: no email is sent. Any 6-digit code signs you in.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new DbError("invalid_email", "Enter one email address, like ada@example.com.", 400);
    return;
  }
  await api("/session/email", { method: "POST", body: JSON.stringify({ email }) });
}

/** Email sign-in, step 2: the code from the email. Returns the address now signed in. */
export async function verifyEmailCode(email: string, code: string): Promise<string> {
  const clean = code.replace(/\s+/g, "");
  if (isPreview) {
    if (!/^[0-9]{6}$/.test(clean)) throw new DbError("code_invalid", "Enter the 6-digit code from the email.", 401);
    previewWallet = null;
    previewEmail = email.trim().toLowerCase();
    return previewEmail;
  }
  return (await api<{ email: string }>("/session/email/verify", { method: "POST", body: JSON.stringify({ email, code: clean }) })).email;
}

/** True when the signed-in wallet owns this app on GoodBuild. Always true in the preview. */
export async function isAppOwner(): Promise<boolean> {
  if (isPreview) return true;
  return (await api<{ owner?: boolean }>("/session")).owner === true;
}

/** The wallet signed in to this app, or null. */
export async function currentWallet(): Promise<string | null> {
  if (isPreview) return previewWallet;
  return (await api<{ wallet: string | null }>("/session")).wallet;
}

/** Connect the wallet if needed and sign in to this app. Returns the wallet address. */
export async function signIn(): Promise<string> {
  if (isPreview) {
    showPreviewNote();
    previewWallet = (hasWallet() ? await connectWallet().catch(() => PREVIEW_VISITOR) : PREVIEW_VISITOR).toLowerCase();
    return previewWallet;
  }
  const account = getAddress(await connectWallet());
  const { nonce, domain, uri } = await api<{ nonce: string; domain: string; uri: string }>("/session/nonce");
  const message = signInMessage({ domain, address: account, uri, nonce });
  const wallet = createWalletClient({ account, chain, transport: custom(walletProvider()!) });
  const signature = await wallet.signMessage({ message });
  return (await api<{ wallet: string }>("/session", { method: "POST", body: JSON.stringify({ message, signature }) })).wallet;
}

export async function signOut(): Promise<void> {
  if (isPreview) {
    previewWallet = null;
    previewEmail = null;
    return;
  }
  await api("/session", { method: "DELETE" });
}

/** Delete everything this wallet saved in this app, and sign out. */
export async function deleteMyData(): Promise<void> {
  if (isPreview) {
    const owner = requirePreviewWallet();
    savePreview(previewRecords().filter((r) => r.owner !== owner));
    previewWallet = null;
    return;
  }
  await api("/me", { method: "DELETE" });
}

/** One named collection. Names use lowercase letters, numbers, - and _, and start with a letter. */
export function collection<T = unknown>(name: string) {
  const path = "/c/" + encodeURIComponent(name);
  return {
    /** Newest first: what the rules let you read, in full or only its public fields. */
    async list(options: { owner?: string; limit?: number; cursor?: string } = {}): Promise<DbPage<T>> {
      if (isPreview) {
        showPreviewNote();
        return { records: previewVisible(name, options.owner).slice(0, options.limit ?? 50) as DbRecord<T>[], nextCursor: null };
      }
      const query = new URLSearchParams();
      if (options.owner) query.set("owner", options.owner);
      if (options.limit) query.set("limit", String(options.limit));
      if (options.cursor) query.set("cursor", options.cursor);
      const text = query.toString();
      return api<DbPage<T>>(path + (text ? "?" + text : ""));
    },
    /** One record, or null. Without owner, your own. */
    async get(key: string, options: { owner?: string } = {}): Promise<DbRecord<T> | null> {
      if (isPreview) {
        showPreviewNote();
        const owner = options.owner?.toLowerCase() ?? previewWallet;
        return (previewVisible(name).find((r) => r.key === key && r.owner === owner) as DbRecord<T> | undefined) ?? null;
      }
      try {
        return await api<DbRecord<T>>(path + "/" + encodeURIComponent(key) + (options.owner ? "?owner=" + options.owner : ""));
      } catch (e) {
        if (e instanceof DbError && e.status === 404) return null;
        throw e;
      }
    },
    /** Save under a key you choose, replacing your earlier record with that key. Other wallets' records with the same key are separate. */
    async put(key: string, value: T): Promise<DbRecord<T>> {
      if (isPreview) return previewPut(name, key, value);
      return api<DbRecord<T>>(path + "/" + encodeURIComponent(key), { method: "PUT", body: JSON.stringify({ value }) });
    },
    /** Save a new record with a generated key. Works without sign-in where the rule says "create": "anyone". */
    async add(value: T): Promise<DbRecord<T>> {
      if (isPreview) return previewPut(name, crypto.randomUUID(), value);
      return api<DbRecord<T>>(path, { method: "POST", body: JSON.stringify({ value }) });
    },
    /** Delete your own record. The app's owner can pass owner to delete someone else's, where the rule allows it. */
    async remove(key: string, options: { owner?: string | null } = {}): Promise<void> {
      if (isPreview) {
        const owner = options.owner ?? previewSubject() ?? PREVIEW_ANON;
        savePreview(previewRecords().filter((r) => !(r.key === key && r.owner === owner && r.collection === name)));
        return;
      }
      await api(path + "/" + encodeURIComponent(key) + (options.owner ? "?owner=" + encodeURIComponent(options.owner) : ""), { method: "DELETE" });
    },
  };
}
`;

const USE_DB = `import { useCallback, useEffect, useRef, useState } from "react";
import { collection, isPreview, sendEmailCode, sessionInfo, signIn as dbSignIn, signOut as dbSignOut, verifyEmailCode, type DbRecord } from "./db";
import { errorMessage } from "./format";
import { subscribeWallet, walletState } from "./goodbuild/wallet";
import { useRead } from "./hooks";

/**
 * Who is signed in to this app's saved data. Separate from useWallet: connecting a wallet only shows
 * its address, signing in proves it. If the visitor switches account, they must sign in again.
 */
export function useDbSession() {
  const [wallet, setWallet] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [emailSignIn, setEmailSignIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const walletSession = useRef<string | null>(null);
  walletSession.current = wallet;

  const refresh = useCallback(async () => {
    const s = await sessionInfo();
    setWallet(s.wallet);
    setEmail(s.email);
    setIsOwner(s.owner);
    setEmailSignIn(s.emailSignIn);
  }, []);

  useEffect(() => {
    refresh().catch(() => setWallet(null)).finally(() => setLoading(false));
    // Switching or disconnecting the wallet ends a wallet sign-in, on the server too, so a reload
    // doesn't bring it back. No wallet connected yet doesn't: the session outlives the page, and the
    // wallet reconnects a moment after it loads. An email sign-in has no wallet here, so it's untouched.
    let last = (walletState().account ?? "").toLowerCase();
    return subscribeWallet(() => {
      const account = (walletState().account ?? "").toLowerCase();
      if (account === last) return;
      last = account;
      if (!walletSession.current || walletSession.current === account) return;
      walletSession.current = null;
      setWallet(null);
      setIsOwner(isPreview);
      void dbSignOut().catch(() => {});
    });
  }, [refresh]);

  /** Run one step, keeping signingIn and error in step. */
  const step = useCallback(async (run: () => Promise<void>) => {
    setSigningIn(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSigningIn(false);
    }
  }, []);

  /** Wallet sign-in: connect if needed, then one signature (no transaction, no gas). */
  const signIn = useCallback(() => step(async () => {
    await dbSignIn();
    await refresh();
  }), [step, refresh]);

  /** Email sign-in, step 1: send the code. Then show a code box and call confirmCode. */
  const sendCode = useCallback((address: string) => step(async () => {
    await sendEmailCode(address);
    setCodeSentTo(address.trim().toLowerCase());
  }), [step]);

  /** Email sign-in, step 2: the 6 digits from the email. */
  const confirmCode = useCallback((code: string) => step(async () => {
    if (!codeSentTo) throw new Error("Ask for a code first.");
    await verifyEmailCode(codeSentTo, code);
    setCodeSentTo(null);
    await refresh();
  }), [step, refresh, codeSentTo]);

  const signOut = useCallback(async () => {
    setError(null);
    await dbSignOut().catch(() => {});
    setWallet(null);
    setEmail(null);
    setCodeSentTo(null);
    setIsOwner(isPreview);
  }, []);

  /**
   * signedIn: by wallet or by email. Use it for enabled, not wallet, so email visitors see their records.
   * isOwner: the app's owner is signed in (always in the preview), so show the owner view behind it.
   * emailSignIn: this app offers email codes. codeSentTo: an address is waiting for its code.
   */
  const signedIn = Boolean(wallet || email);
  return { wallet, email, signedIn, isOwner, emailSignIn, loading, signingIn, codeSentTo, error, signIn, sendCode, confirmCode, signOut, isPreview };
}

/**
 * The records of one collection, newest first, with loading and error state. Pass enabled=false to
 * wait (a private collection needs a signed-in wallet). Writes refresh the list; they throw on
 * failure, so wrap them in try/catch and show errorMessage(e).
 *   const notes = useCollection<Note>("notes", { enabled: session.signedIn, wallet: session.wallet ?? session.email });
 *   await notes.add({ text });
 */
export function useCollection<T>(name: string, options: { owner?: string; limit?: number; enabled?: boolean; wallet?: string | null } = {}) {
  const { owner, limit, enabled = true, wallet } = options;
  const store = collection<T>(name);
  const read = useRead(() => store.list({ owner, limit }), [name, owner, limit, wallet], enabled);
  // Not while disabled, so one visitor's records don't stay on screen after they sign out.
  const records: DbRecord<T>[] = enabled ? read.data?.records ?? [] : [];

  async function after<R>(write: Promise<R>): Promise<R> {
    const result = await write;
    await read.refresh();
    return result;
  }
  return {
    records,
    loading: read.loading,
    error: read.error,
    refresh: read.refresh,
    add: (value: T) => after(store.add(value)),
    put: (key: string, value: T) => after(store.put(key, value)),
    remove: (key: string, owner?: string | null) => after(store.remove(key, { owner })),
  };
}
`;

const CONTRACTS_INDEX = `// Platform-owned. GoodBuild writes one module per compiled contract next to this file
// (ABI after each build, addresses after you deploy). Don't edit by hand.
export {};
`;


const BUTTON = `import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        outline: "border border-border bg-background hover:bg-muted",
        ghost: "hover:bg-muted",
        accent: "bg-accent text-accent-foreground hover:opacity-90",
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
  return <div className={cn("rounded-lg border border-border bg-card shadow-sm", className)} {...props} />;
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

const SKELETON = `import * as React from "react";
import { cn } from "../../lib/utils";

/** Grey shimmer block for loading values. Size it with classes: <Skeleton className="h-6 w-24" /> */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;
}
`;

const NOTICE = `import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "../../lib/utils";

const tones = {
  info: { box: "bg-accent/5 text-foreground", icon: Info, iconClass: "text-accent" },
  success: { box: "bg-success/10 text-foreground", icon: CheckCircle2, iconClass: "text-success" },
  warning: { box: "bg-warning/10 text-foreground", icon: AlertTriangle, iconClass: "text-warning" },
  danger: { box: "bg-danger/10 text-foreground", icon: XCircle, iconClass: "text-danger" },
};

/** Inline message: errors, success after a transaction, "deploy to go live" hints. */
export function Notice({
  tone = "info",
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof tones;
  title?: React.ReactNode;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const t = tones[tone];
  const Icon = t.icon;
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("flex items-start gap-3 rounded-lg p-4 text-sm", t.box, className)}>
      <Icon className={cn("mt-0.5 size-4 shrink-0", t.iconClass)} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="break-words text-muted-foreground">{children}</div>}
      </div>
      {action}
    </div>
  );
}
`;

const TEXTAREA = `import * as React from "react";
import { cn } from "../../lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn("min-h-20 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-accent/30", className)}
      {...props}
    />
  );
}
`;

/** Files every project starts with (paths without a leading slash). */
export function starterFiles(chainId = NETWORKS["celo-sepolia"].chainId): Record<string, string> {
  return {
    "package.json": packageJson(BASE_DEPENDENCIES),
    "public/index.html": INDEX_HTML,
    "src/main.tsx": MAIN,
    "src/styles.css": STYLES,
    "src/App.tsx": APP,
    "src/lib/utils.ts": UTILS,
    "src/lib/chain.ts": chainSourceFor(chainId),
    "src/lib/useWallet.ts": USE_WALLET,
    "src/lib/tokens.ts": TOKENS,
    "src/lib/format.ts": FORMAT,
    "src/lib/hooks.ts": HOOKS,
    "src/lib/db.ts": DB,
    "src/lib/useDb.ts": USE_DB,
    "src/lib/dataRules.json": DATA_RULES,
    ...walletHelpersFor(chainId),
    "src/contracts/index.ts": CONTRACTS_INDEX,
    "src/components/ConnectButton.tsx": CONNECT_BUTTON,
    "src/components/ui/button.tsx": BUTTON,
    "src/components/ui/card.tsx": CARD,
    "src/components/ui/input.tsx": INPUT,
    "src/components/ui/label.tsx": LABEL,
    "src/components/ui/badge.tsx": BADGE,
    "src/components/ui/skeleton.tsx": SKELETON,
    "src/components/ui/notice.tsx": NOTICE,
    "src/components/ui/textarea.tsx": TEXTAREA,
  };
}

/**
 * Older projects started before a helper existed. Add starter helpers and UI pieces that
 * are missing (never overwrite), so the prompt's list of available files is always true.
 */
export function withStarterHelpers(files: Record<string, string>, chainId = NETWORKS["celo-sepolia"].chainId): Record<string, string> {
  const out = withCurrentWalletHelpers(withCurrentDataHelpers(files), chainId);
  for (const [p, content] of Object.entries(starterFiles(chainId))) {
    if (/^src\/(lib|components\/ui)\//.test(p) && !(p in out)) out[p] = content;
  }
  return out;
}

/** The data helpers are GoodBuild's, and the builder can't edit them, so every project always gets the current ones (D34). */
export const DATA_HELPERS: Record<string, string> = { "src/lib/db.ts": DB, "src/lib/useDb.ts": USE_DB };

export function withCurrentDataHelpers(files: Record<string, string>): Record<string, string> {
  const out = { ...files };
  for (const [p, content] of Object.entries(DATA_HELPERS)) if (p in out) out[p] = content;
  return out;
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
