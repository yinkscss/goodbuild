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

import { createHash } from "node:crypto";

import { NETWORKS } from "@/config/networks";
import { chainSourceFor, CONNECT_BUTTON, USE_WALLET, walletHelpersFor, withCurrentWalletHelpers } from "./wallet-template";

export { WALLET_DIR, WALLET_HELPERS, withCurrentWalletHelpers } from "./wallet-template";

import { allKitPackages } from "./kits/registry";
import { UI_PRIMITIVES } from "./ui-primitives";

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
 * Harness v2 (D152, WS4): vetted packages a v2 build may add on top of the base list. Browser-only, no
 * network calls of their own, MIT or Apache-2.0, React 18 compatible, each published at least two weeks
 * before it was pinned. Sizes (minified + gzipped, as the publish bundle builds them) are in the packages
 * guide. Publishing accepts them for any project, so a project built under v2 keeps working if the
 * flag goes off; only v2 builds are told about them or may add them.
 */
export const V2_PACKAGES: Record<string, string> = {
  zustand: "5.0.16",
  immer: "11.2.9",
  zod: "4.6.7",
  "react-hook-form": "7.91.0",
  recharts: "3.10.1",
  "@dnd-kit/core": "6.3.1",
  "@dnd-kit/sortable": "10.0.0",
  "matter-js": "0.20.0",
  howler: "2.2.4",
  "react-markdown": "10.1.0",
  "fuse.js": "7.5.0",
  papaparse: "5.7.0",
  nanoid: "6.0.2",
};

/**
 * Packages added along with another because the in-browser preview doesn't install peer dependencies
 * (recharts needs react-is, @dnd-kit/sortable needs @dnd-kit/core) and a few apps import a helper package
 * directly (@dnd-kit/utilities for CSS.Transform). Each is pinned in ALLOWED_DEPENDENCIES like any other.
 */
export const COMPANION_PACKAGES: Record<string, Record<string, string>> = {
  recharts: { "react-is": "18.3.1" },
  "@dnd-kit/core": { "@dnd-kit/utilities": "3.2.2" },
  "@dnd-kit/sortable": { "@dnd-kit/core": "6.3.1", "@dnd-kit/utilities": "3.2.2" },
};

/**
 * Every package a generated app can have: the base list, the v2 packages and their companions, plus what the
 * kits bring (D71). This is what publishing bundles from and what publish-runtime installs. What one project
 * may add is narrower: packagesFor() in kits/index.ts.
 */
export const ALLOWED_DEPENDENCIES: Record<string, string> = {
  ...BASE_ALLOWED_DEPENDENCIES,
  ...V2_PACKAGES,
  ...Object.assign({}, ...Object.values(COMPANION_PACKAGES)),
  ...allKitPackages(),
};

/**
 * Packages only GoodBuild's own code uses: the WalletConnect module publishing swaps into
 * src/lib/goodbuild/walletConnect.tsx (D36). The builder can't import or add them.
 */
export const PLATFORM_DEPENDENCIES: Record<string, string> = {
  "@walletconnect/ethereum-provider": "2.26.0",
  // Types for three.js, so the type check can read it (D77). Only the kit's three is importable.
  "@types/three": "0.187.0",
  // Types for the v2 packages that ship none (D152).
  "@types/matter-js": "0.20.2",
  "@types/howler": "2.2.13",
  "@types/papaparse": "5.5.2",
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
import { markChanged, subscribeChanges } from "./goodbuild/live";

/**
 * Run an async read (usually publicClient.readContract) with loading and error state, and keep it
 * up to date by itself (D158): it fetches again after any confirmed transaction (writeContract, useTx),
 * a saved-data write, a wallet switch, the tab coming back, and on a slow shared timer while the page
 * is open, so other people's changes show too. Never call refresh() after a write just to update it.
 * Pass enabled=false to skip it (e.g. no wallet or no deployed address yet), and { live: false } for a
 * value that can never change (a token's name or decimals).
 *   const tips = useRead(() => publicClient.readContract({ address, abi, functionName: "totalTips" }), [address], !!address);
 * loading is the first load only (show a Skeleton). refreshing is a fetch with the old value still on
 * screen (don't hide it); updatedAt is when it last arrived. Put <RefreshButton read={tips} /> next to it.
 */
export function useRead<T>(fn: () => Promise<T>, deps: unknown[], enabled = true, options: { live?: boolean } = {}) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(enabled);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);
  const hasData = useRef(false);
  const live = options.live !== false;

  // background: keep the value and any earlier error on screen, and don't show a failed timer fetch.
  const load = useCallback(async (background: boolean) => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const id = ++seq.current;
    if (hasData.current) setRefreshing(true);
    else setLoading(true);
    if (!background) setError(null);
    try {
      const next = await fnRef.current();
      if (id !== seq.current) return; // A newer fetch started: its answer wins.
      hasData.current = true;
      setData(next);
      setError(null);
      setUpdatedAt(Date.now());
    } catch (e) {
      if (id !== seq.current) return;
      if (!background || !hasData.current) setError(errorMessage(e));
    } finally {
      if (id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    // New inputs (another account, another address) start fresh rather than refresh the old value.
    hasData.current = false;
    void load(false);
  }, [load]);

  useEffect(() => {
    if (!enabled || !live) return;
    return subscribeChanges((kinds) => loadRef.current(!kinds.has("manual")));
  }, [enabled, live]);

  const refresh = useCallback(() => loadRef.current(false), []);
  return { data, loading, refreshing, error, updatedAt, refresh };
}

/**
 * Track one wallet transaction: pending while the wallet signs and the chain confirms,
 * then success or a readable error. Once it succeeds, every useRead on the page fetches again.
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
      void markChanged("tx");
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

/** hooks.ts as GoodBuild wrote it before D158. An untouched copy moves to the live one. */
const HOOKS_BEFORE_LIVE_SHA256 = "963faadf84cc4850ac684ca5c4da481591eccf938cd0442da43773a7cb1957a5";

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
import { markChanged } from "./goodbuild/live";
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
  /** Set on a filtered list when there were more matching records than were returned, or older ones weren't read. */
  truncated?: boolean;
}

/** One condition on a record's fields. Only fields you can see are compared. */
export type DbWhere = [field: string, op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte", value: string | number | boolean];

export interface DbListOptions {
  owner?: string;
  limit?: number;
  cursor?: string;
  /** Keep only records whose fields pass every condition (up to 4), e.g. [["status", "eq", "open"], ["score", "gte", 10]]. */
  where?: DbWhere[];
  /** Sort by a field of the value, or "createdAt" / "updatedAt". Default: newest first. */
  orderBy?: string;
  dir?: "asc" | "desc";
  /** Only records saved or changed after this time (an ISO date or milliseconds). For polling a live app. */
  since?: string | number;
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
type Rule = { create: string; read: string[]; public: string[]; fields: Record<string, string> | null; unique: string[]; dealt?: boolean };
/** The same reading of dataRules.json as the server's, for the preview. */
function ruleOf(name: string): Rule {
  const raw = (rules as { collections?: Record<string, unknown> }).collections?.[name];
  const base: Rule = { create: "signed-in", read: ["writer"], public: [], fields: null, unique: [] };
  if (raw === "public-read") return { ...base, read: ["anyone"] };
  if (raw === "dealt") return { ...base, dealt: true };
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

/** A key for a new record in the preview. crypto.randomUUID only exists on https and localhost pages, so plain http previews make one from random bytes. */
function newRecordKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
}

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

function previewPut<T>(collection: string, key: string, value: T, dealtTo?: string): DbRecord<T> {
  const rule = ruleOf(collection);
  if (rule.dealt && !dealtTo) throw new DbError("forbidden", "Only GoodBuild's dealer writes here. Use deal() instead.", 403);
  const owner = dealtTo ?? previewSubject() ?? (rule.create === "anyone" ? PREVIEW_ANON : requirePreviewWallet());
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

/**
 * In the preview you are the owner, so you see what the owner would. A record you can't read in full
 * shows only its public fields, without who wrote it, as on the server.
 */
function previewVisible(collection: string, owner?: string): DbRecord[] {
  const rule = ruleOf(collection);
  return previewRecords()
    .filter((r) => r.collection === collection)
    .map((r): Stored | null => {
      if (rule.read.some((x) => x === "anyone" || (x === "owner" && !rule.dealt) || (x === "signed-in" && previewSubject()) || (x === "writer" && r.owner === (previewSubject() ?? PREVIEW_ANON)))) return r;
      const v = r.value as Record<string, unknown> | null;
      if (!rule.public.length || !v || typeof v !== "object" || Array.isArray(v)) return null;
      return { ...r, owner: null, value: Object.fromEntries(rule.public.filter((f) => f in v).map((f) => [f, v[f]])) };
    })
    .filter((r): r is Stored => r !== null && (!owner || r.owner === owner.toLowerCase()));
}

/** The preview's version of a filtered list, the same comparisons the server makes. */
function previewList<T>(name: string, options: DbListOptions, since: number | undefined): DbPage<T> {
  let records = previewVisible(name, options.owner) as DbRecord<T>[];
  if (since !== undefined) records = records.filter((r) => Date.parse(r.updatedAt) > since);
  for (const [field, op, expected] of options.where ?? []) {
    records = records.filter((r) => {
      const v = r.value as unknown as Record<string, unknown> | null;
      if (!v || typeof v !== "object" || !(field in v) || typeof v[field] !== typeof expected) return false;
      const got = v[field] as string | number;
      const want = expected as string | number;
      return op === "eq" ? got === want : op === "ne" ? got !== want : op === "gt" ? got > want : op === "gte" ? got >= want : op === "lt" ? got < want : got <= want;
    });
  }
  if (options.orderBy) {
    const sign = options.dir === "asc" ? 1 : -1;
    const keyOf = (r: DbRecord<T>): string | number | boolean | null => {
      if (options.orderBy === "createdAt" || options.orderBy === "updatedAt") return Date.parse(r[options.orderBy]);
      const x = (r.value as unknown as Record<string, unknown> | null)?.[options.orderBy!];
      return typeof x === "string" || typeof x === "number" || typeof x === "boolean" ? x : null;
    };
    records = [...records].sort((a, b) => {
      const x = keyOf(a);
      const y = keyOf(b);
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
      if (typeof x !== typeof y) return typeof x < typeof y ? -sign : sign;
      return x === y ? 0 : x < y ? -sign : sign;
    });
  }
  const limit = options.limit ?? 50;
  return { records: records.slice(0, limit), nextCursor: null, ...(options.where?.length || options.orderBy || since !== undefined ? { truncated: records.length > limit } : {}) };
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

// --- The dealer -----------------------------------------------------------------------------------

/** A deal's receipt: who is in it and how many items each holds. Never the items. */
export interface DealReceipt {
  id: string;
  room: string;
  /** The wallet that asked for the deal. Check it is the room's host before trusting a deal id. */
  host: string;
  players: string[];
  hands: number[];
  drawn: number[];
  /** Items left to draw. */
  stock: number;
}

/** What each player reads from the dealt collection: the deal it came from and their items. */
export interface DealtHand {
  deal: string;
  room: string;
  items: string[];
}

const PREVIEW_DEALS = "goodbuild-preview-deals";
type PreviewDeal = DealReceipt & { left: string[] };
const previewDeals = (): PreviewDeal[] => {
  try {
    return JSON.parse(localStorage.getItem(PREVIEW_DEALS) ?? "[]") as PreviewDeal[];
  } catch {
    return [];
  }
};
const savePreviewDeals = (deals: PreviewDeal[]) => {
  try {
    localStorage.setItem(PREVIEW_DEALS, JSON.stringify(deals));
  } catch {
    // Private windows may refuse.
  }
};
const receiptOf = (d: PreviewDeal): DealReceipt => ({ id: d.id, room: d.room, host: d.host, players: d.players, hands: d.hands, drawn: d.drawn, stock: d.left.length });

/**
 * GoodBuild's dealer: the server shuffles deck and gives each player hand items, written to the
 * "dealt" collection so that only that player can read theirs (not other players, not you, not the
 * app's owner). The rest stays with the server as the stock, for draw(). Declare the collection in
 * dataRules.json as "hands": "dealt". players are wallet addresses (2 to 10), deck 1 to 120 short texts.
 * In the preview everyone is in this browser, so nothing is secret there.
 */
export async function deal(collectionName: string, input: { room: string; players: string[]; deck: string[]; hand: number }): Promise<DealReceipt> {
  if (isPreview) {
    showPreviewNote("Preview: dealt hands stay in this browser and aren't secret here. Once published, only each player sees theirs.");
    const host = requirePreviewWallet();
    const players = input.players.map((p) => p.toLowerCase());
    if (players.length < 2 || input.hand < 1 || players.length * input.hand > input.deck.length) throw new DbError("invalid_deal", "Each player needs a hand, and the deck must be big enough.", 400);
    const deck = [...input.deck];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const id = newRecordKey();
    players.forEach((p, i) => previewPut<DealtHand>(collectionName, id, { deal: id, room: input.room, items: deck.slice(i * input.hand, (i + 1) * input.hand) }, p));
    const made: PreviewDeal = { id, room: input.room, host, players, hands: players.map(() => input.hand), drawn: players.map(() => 0), stock: 0, left: deck.slice(players.length * input.hand) };
    savePreviewDeals([...previewDeals(), made]);
    return receiptOf(made);
  }
  return api<DealReceipt>("/deal/" + encodeURIComponent(collectionName), { method: "POST", body: JSON.stringify(input) });
}

/** A deal's receipt, for its host and players. */
export async function dealInfo(collectionName: string, id: string): Promise<DealReceipt> {
  if (isPreview) {
    const found = previewDeals().find((d) => d.id === id);
    if (!found) throw new DbError("not_found", "There's no such deal.", 404);
    return receiptOf(found);
  }
  return api<DealReceipt>("/deal/" + encodeURIComponent(collectionName) + "/" + encodeURIComponent(id));
}

/** Take count (1 to 10) items from the top of the stock, for you only. Saved as another record in the dealt collection. */
export async function draw(collectionName: string, id: string, count = 1): Promise<{ items: string[]; deal: DealReceipt }> {
  if (isPreview) {
    const me = requirePreviewWallet();
    const deals = previewDeals();
    const found = deals.find((d) => d.id === id);
    const seat = found ? found.players.indexOf(me) : -1;
    if (!found || seat < 0) throw new DbError("not_found", "There's no such deal.", 404);
    if (!found.left.length) throw new DbError("stock_empty", "There's nothing left to draw.", 409);
    const items = found.left.slice(0, count);
    found.left = found.left.slice(items.length);
    found.drawn[seat]++;
    found.hands[seat] += items.length;
    savePreviewDeals(deals);
    previewPut<DealtHand>(collectionName, id + ".d" + found.drawn[seat], { deal: id, room: found.room, items }, me);
    return { items, deal: receiptOf(found) };
  }
  return api<{ items: string[]; deal: DealReceipt }>("/deal/" + encodeURIComponent(collectionName) + "/" + encodeURIComponent(id) + "/draw", { method: "POST", body: JSON.stringify({ count }) });
}

/** One named collection. Names use lowercase letters, numbers, - and _, and start with a letter. */
export function collection<T = unknown>(name: string) {
  const path = "/c/" + encodeURIComponent(name);
  return {
    /** Newest first: what the rules let you read, in full or only its public fields. */
    async list(options: DbListOptions = {}): Promise<DbPage<T>> {
      // The server reads 1 to 100 records at a time: ask for more and get the most it gives, not an error.
      if (options.limit !== undefined) options = { ...options, limit: Math.max(1, Math.min(100, Math.floor(options.limit) || 1)) };
      const since = options.since === undefined ? undefined : typeof options.since === "number" ? options.since : Date.parse(options.since);
      if (since !== undefined && !Number.isFinite(since)) throw new DbError("invalid_query", "since must be a date or a number of milliseconds.", 400);
      if (isPreview) {
        showPreviewNote();
        return previewList<T>(name, options, since);
      }
      const query = new URLSearchParams();
      if (options.owner) query.set("owner", options.owner);
      if (options.limit) query.set("limit", String(options.limit));
      if (options.cursor) query.set("cursor", options.cursor);
      for (const [field, op, value] of options.where ?? []) query.append("where", field + "~" + op + "~" + JSON.stringify(value));
      if (options.orderBy) query.set("order", options.orderBy);
      if (options.dir) query.set("dir", options.dir);
      if (since !== undefined) query.set("since", String(Math.floor(since)));
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
      if (isPreview) return changed(previewPut(name, key, value));
      return changed(await api<DbRecord<T>>(path + "/" + encodeURIComponent(key), { method: "PUT", body: JSON.stringify({ value }) }));
    },
    /** Save a new record with a generated key. Works without sign-in where the rule says "create": "anyone". */
    async add(value: T): Promise<DbRecord<T>> {
      if (isPreview) return changed(previewPut(name, newRecordKey(), value));
      return changed(await api<DbRecord<T>>(path, { method: "POST", body: JSON.stringify({ value }) }));
    },
    /** Delete your own record. The app's owner can pass owner to delete someone else's, where the rule allows it. */
    async remove(key: string, options: { owner?: string | null } = {}): Promise<void> {
      if (isPreview) {
        const owner = options.owner ?? previewSubject() ?? PREVIEW_ANON;
        savePreview(previewRecords().filter((r) => !(r.key === key && r.owner === owner && r.collection === name)));
        changed(null);
        return;
      }
      await api(path + "/" + encodeURIComponent(key) + (options.owner ? "?owner=" + encodeURIComponent(options.owner) : ""), { method: "DELETE" });
      changed(null);
    },
  };
}

/** A write went through: every list on the page that shows saved data fetches again (D158). */
function changed<R>(result: R): R {
  void markChanged("data");
  return result;
}
`;

const USE_DB = `import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { collection, isPreview, sendEmailCode, sessionInfo, signIn as dbSignIn, signOut as dbSignOut, verifyEmailCode, type DbRecord, type DbWhere } from "./db";
import { errorMessage } from "./format";
import { markChanged, subscribeChanges } from "./goodbuild/live";
import { subscribeWallet, walletState } from "./goodbuild/wallet";
import { useRead } from "./hooks";

// One sign-in for the whole app. Every useDbSession() reads the same state, so a sign-in button on
// one card updates the header, the page that decides what to show, and every list waiting on it.
interface SessionState {
  wallet: string | null;
  email: string | null;
  isOwner: boolean;
  emailSignIn: boolean;
  loading: boolean;
  codeSentTo: string | null;
}
let session: SessionState = { wallet: null, email: null, isOwner: false, emailSignIn: false, loading: true, codeSentTo: null };
const sessionListeners = new Set<() => void>();
let started = false;

function setSession(next: Partial<SessionState>) {
  session = { ...session, ...next };
  for (const listener of [...sessionListeners]) listener();
}
function subscribeSession(listener: () => void): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}
const readSession = () => session;

async function refreshSession() {
  const s = await sessionInfo();
  setSession({ wallet: s.wallet, email: s.email, isOwner: s.owner, emailSignIn: s.emailSignIn });
}

/** Read the session once for the whole app, and end a wallet sign-in when the wallet changes. */
function startSession() {
  if (started) return;
  started = true;
  refreshSession().catch(() => setSession({ wallet: null })).finally(() => setSession({ loading: false }));
  // Switching or disconnecting the wallet ends a wallet sign-in, on the server too, so a reload
  // doesn't bring it back. No wallet connected yet doesn't: the session outlives the page, and the
  // wallet reconnects a moment after it loads. An email sign-in has no wallet here, so it's untouched.
  let last = (walletState().account ?? "").toLowerCase();
  subscribeWallet(() => {
    const account = (walletState().account ?? "").toLowerCase();
    if (account === last) return;
    last = account;
    if (!session.wallet || session.wallet === account) return;
    setSession({ wallet: null, isOwner: isPreview });
    void dbSignOut().catch(() => {});
  });
}

/**
 * Who is signed in to this app's saved data. Separate from useWallet: connecting a wallet only shows
 * its address, signing in proves it. If the visitor switches account, they must sign in again.
 * Call it in as many components as you like: they all share one sign-in.
 */
export function useDbSession() {
  const state = useSyncExternalStore(subscribeSession, readSession, readSession);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    startSession();
  }, []);

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
    await refreshSession();
  }), [step]);

  /** Email sign-in, step 1: send the code. Then show a code box and call confirmCode. */
  const sendCode = useCallback((address: string) => step(async () => {
    await sendEmailCode(address);
    setSession({ codeSentTo: address.trim().toLowerCase() });
  }), [step]);

  /** Email sign-in, step 2: the 6 digits from the email. */
  const confirmCode = useCallback((code: string) => step(async () => {
    const sentTo = session.codeSentTo;
    if (!sentTo) throw new Error("Ask for a code first.");
    await verifyEmailCode(sentTo, code);
    setSession({ codeSentTo: null });
    await refreshSession();
  }), [step]);

  const signOut = useCallback(async () => {
    setError(null);
    await dbSignOut().catch(() => {});
    setSession({ wallet: null, email: null, codeSentTo: null, isOwner: isPreview });
  }, []);

  /**
   * signedIn: by wallet or by email. Use it for enabled, not wallet, so email visitors see their records.
   * isOwner: the app's owner is signed in (always in the preview), so show the owner view behind it.
   * emailSignIn: this app offers email codes. codeSentTo: an address is waiting for its code.
   */
  const { wallet, email, isOwner, emailSignIn, loading, codeSentTo } = state;
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
export function useCollection<T>(
  name: string,
  options: { owner?: string; limit?: number; enabled?: boolean; wallet?: string | null; where?: DbWhere[]; orderBy?: string; dir?: "asc" | "desc"; liveEvery?: number } = {},
) {
  const { owner, limit, enabled = true, wallet, where, orderBy, dir, liveEvery } = options;
  const store = collection<T>(name);
  const queryKey = JSON.stringify([where ?? [], orderBy ?? "", dir ?? ""]);
  // live: false, because saved data listens here, without the chain's timer (D158): it fetches again
  // after any saved-data write, a wallet switch, the tab coming back and the refresh button, so
  // GoodBuild's server only sees a read when something could have changed.
  const read = useRead(() => store.list({ owner, limit, where, orderBy, dir }), [name, owner, limit, wallet, queryKey], enabled, { live: false });
  const refreshRef = useRef(read.refresh);
  refreshRef.current = read.refresh;
  useEffect(() => {
    if (!enabled) return;
    return subscribeChanges(() => refreshRef.current(), { on: ["data", "wallet", "focus", "manual"] });
  }, [enabled]);
  // Live apps (a lobby, a turn-based game): fetch again every few seconds while the page is showing.
  useEffect(() => {
    if (!enabled || !liveEvery) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refreshRef.current();
    }, Math.max(2_000, liveEvery));
    return () => clearInterval(timer);
  }, [enabled, liveEvery]);
  // Not while disabled, so one visitor's records don't stay on screen after they sign out.
  const records: DbRecord<T>[] = enabled ? read.data?.records ?? [] : [];

  // The write already told the page; waiting for that refresh means the list is new when this resolves.
  async function after<R>(write: Promise<R>): Promise<R> {
    const result = await write;
    await markChanged("data");
    return result;
  }
  return {
    records,
    /** True when the server read only the newest 500 records for this filtered or ordered list. */
    truncated: enabled ? read.data?.truncated === true : false,
    loading: read.loading,
    /** Fetching again with the old list still on screen: keep showing it. (Read loosely: an app's own older hooks.ts has neither.) */
    refreshing: (read as { refreshing?: boolean }).refreshing === true,
    updatedAt: (read as { updatedAt?: number | null }).updatedAt ?? null,
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

/**
 * The refresh button next to anything that changes (D158). Values already refresh by themselves, so
 * this is the visitor's "check now": one per card or section, not one per number.
 */
const REFRESH_BUTTON = `import { RotateCw } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { lastRefreshedAt, refreshAll, subscribeRefreshed } from "../../lib/goodbuild/live";
import { cn } from "../../lib/utils";

interface Refreshable {
  refresh: () => Promise<unknown>;
  refreshing?: boolean;
  updatedAt?: number | null;
}

function ago(at: number | null | undefined, now: number): string {
  if (!at) return "Refresh";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 5) return "Updated just now";
  if (s < 60) return "Updated " + s + "s ago";
  const m = Math.round(s / 60);
  return m < 60 ? "Updated " + m + " min ago" : "Updated over an hour ago";
}

/**
 * A small round-arrow button that fetches again and spins while it does. Hovering shows when the
 * value last arrived.
 *   <RefreshButton read={balance} />   one useRead or useCollection (it also spins on their own refreshes)
 *   <RefreshButton />                  everything on the page (refreshAll)
 * Put it in a card's header, next to its title, or beside a big number. Values refresh on their own
 * after transactions and saved-data writes, so it's the fallback, not the way things update.
 */
export function RefreshButton({ read, label = "Refresh", className }: { read?: Refreshable; label?: string; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const pageAt = useSyncExternalStore(subscribeRefreshed, lastRefreshedAt, lastRefreshedAt);
  const spinning = busy || read?.refreshing === true;
  const updatedAt = read ? read.updatedAt : pageAt;

  async function onClick() {
    if (busy) return;
    setBusy(true);
    try {
      await (read ? read.refresh() : refreshAll());
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={() => setNow(Date.now())}
      onFocus={() => setNow(Date.now())}
      aria-label={label}
      aria-busy={spinning}
      title={spinning ? "Refreshing…" : ago(updatedAt, now)}
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
    >
      <RotateCw className={cn("size-4", spinning && "motion-safe:animate-spin")} aria-hidden="true" />
    </button>
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
    "src/components/ui/refresh-button.tsx": REFRESH_BUTTON,
    // Dialog, sheet, tabs, select, dropdown menu, tooltip, toast, accordion, avatar and switch (D89).
    ...UI_PRIMITIVES,
  };
}

/**
 * Older projects started before a helper existed. Add starter helpers and UI pieces that
 * are missing (never overwrite), so the prompt's list of available files is always true.
 */
export function withStarterHelpers(files: Record<string, string>, chainId = NETWORKS["celo-sepolia"].chainId): Record<string, string> {
  const out = withCurrentWalletHelpers(withCurrentDataHelpers(files), chainId);
  // An untouched hooks.ts from before D158 moves to the live one; an edited one stays the builder's.
  if (out["src/lib/hooks.ts"] && createHash("sha256").update(out["src/lib/hooks.ts"]).digest("hex") === HOOKS_BEFORE_LIVE_SHA256) out["src/lib/hooks.ts"] = HOOKS;
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
