import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { deployments, type Deployment } from "@/server/db/deploy-schema";
import { PROXY_IDENTIFIER } from "./compile";

/** Sourcify's public server. It lists both Celo chains as supported (checked 5 Nov 2026). */
export const SOURCIFY_URL = process.env.SOURCIFY_URL ?? "https://sourcify.dev/server";

type Fetch = typeof fetch;

export interface VerifyOutcome {
  status: "verified" | "pending" | "failed" | "unsupported";
  detail: string;
}

/** Fully qualified name of the deployed contract inside the standard JSON input. */
function identifier(d: Pick<Deployment, "stdJsonInput" | "contractName">): string | null {
  const sources = (d.stdJsonInput as { sources?: Record<string, unknown> } | null)?.sources ?? {};
  const file = Object.keys(sources).find((p) => p.startsWith("contracts/") && p === `contracts/${d.contractName}.sol`);
  return file ? `${file}:${d.contractName}` : null;
}

export interface VerifyOptions {
  pollMs?: number;
  polls?: number;
  identifier?: string;
  /**
   * How many times to submit again when Sourcify can't fetch the bytecode yet. Its node can lag
   * behind a just-mined block (the Celo Sepolia live test, 6 Nov 2026). Default 0: the manual
   * verify route is itself the later retry, and has 60 seconds for two contracts.
   */
  bytecodeRetries?: number;
  /** Wait before each new submission. */
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Sourcify's answer when its own RPC doesn't have the contract yet. That's a "not yet", not a mismatch. */
const NOT_YET = /cannot[\s_-]*fetch[\s_-]*bytecode/i;
const notYet = (e: { customCode?: string; message?: string } | undefined) => Boolean(e && (NOT_YET.test(e.customCode ?? "") || NOT_YET.test(e.message ?? "")));
const NOT_YET_OUTCOME: VerifyOutcome = { status: "pending", detail: "Sourcify can't see the new contract yet. We'll try again." };

/**
 * Submit to Sourcify (D17: Sourcify first, Celoscan later) and wait briefly for the verdict.
 * A job that is still running returns "pending"; call again later. Sourcify forwards verified
 * contracts to Blockscout and Etherscan-style explorers on its own.
 */
export async function verifyOnSourcify(d: Pick<Deployment, "stdJsonInput" | "contractName" | "chainId" | "address" | "compilerVersion" | "txHash">, f: Fetch = fetch, opts: VerifyOptions = {}): Promise<VerifyOutcome> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retries = opts.bytecodeRetries ?? 0;
  for (let attempt = 0; ; attempt++) {
    const out = await submitOnce(d, f, opts, sleep);
    if (out !== NOT_YET_OUTCOME || attempt >= retries) return out;
    await sleep(opts.retryMs ?? 5000);
  }
}

async function submitOnce(d: Parameters<typeof verifyOnSourcify>[0], f: Fetch, opts: VerifyOptions, sleep: (ms: number) => Promise<void>): Promise<VerifyOutcome> {
  const id = opts.identifier ?? identifier(d);
  if (!d.stdJsonInput || !id) return { status: "failed", detail: "The sources for this deployment weren't saved, so it can't be verified." };
  const pollMs = opts.pollMs ?? 1500;
  const polls = opts.polls ?? 8;

  let res: Response;
  try {
    res = await f(`${SOURCIFY_URL}/v2/verify/${d.chainId}/${d.address}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stdJsonInput: d.stdJsonInput, compilerVersion: d.compilerVersion, contractIdentifier: id, creationTransactionHash: d.txHash }),
    });
  } catch {
    return { status: "pending", detail: "Sourcify couldn't be reached. We'll try again." };
  }
  if (res.status === 409) return { status: "verified", detail: "Already verified on Sourcify." };
  if (res.status === 429 || res.status >= 500) return { status: "pending", detail: "Sourcify is busy. We'll try again." };
  if (!res.ok) {
    const body = await errorBody(res);
    return notYet(body) ? NOT_YET_OUTCOME : { status: "failed", detail: body.message ?? body.customCode ?? `Sourcify answered ${res.status}.` };
  }
  const { verificationId } = (await res.json()) as { verificationId?: string };
  if (!verificationId) return { status: "failed", detail: "Sourcify didn't accept the request." };

  for (let i = 0; i < polls; i++) {
    await sleep(pollMs);
    let poll: Response;
    try {
      poll = await f(`${SOURCIFY_URL}/v2/verify/${verificationId}`);
    } catch {
      continue;
    }
    if (!poll.ok) continue;
    const body = (await poll.json()) as { isJobCompleted?: boolean; error?: { customCode?: string; message?: string }; contract?: { match?: string | null } };
    if (!body.isJobCompleted) continue;
    if (body.contract?.match) return { status: "verified", detail: body.contract.match === "exact_match" ? "Exact match on Sourcify." : "Match on Sourcify." };
    if (notYet(body.error)) return NOT_YET_OUTCOME;
    return { status: "failed", detail: body.error?.message ?? "Sourcify couldn't match the bytecode." };
  }
  return { status: "pending", detail: "Sourcify is still checking." };
}

async function errorBody(res: Response): Promise<{ message?: string; customCode?: string }> {
  try {
    return (await res.json()) as { message?: string; customCode?: string };
  } catch {
    return {};
  }
}

/**
 * A contract behind a proxy is two contracts to verify (D33): the current code, from its own creation
 * transaction, and OpenZeppelin's proxy at the address people use. Worst result wins, because a green
 * chip should mean someone can read what the address runs. The stored standard JSON holds both.
 */
export async function verifyProxied(d: Deployment, f: Fetch = fetch, opts: Omit<VerifyOptions, "identifier"> = {}): Promise<VerifyOutcome> {
  const code = await verifyOnSourcify({ ...d, address: d.proxy!.implementation, txHash: d.proxy!.implementationTx }, f, opts);
  const proxy = await verifyOnSourcify(d, f, { ...opts, identifier: PROXY_IDENTIFIER });
  const order: VerifyOutcome["status"][] = ["failed", "unsupported", "pending", "verified"];
  const worst = order.indexOf(code.status) <= order.indexOf(proxy.status) ? code : proxy;
  return { status: worst.status, detail: worst.status === "verified" ? "The code and its proxy both match on Sourcify." : `${worst === code ? "The code" : "The proxy"}: ${worst.detail}` };
}

/**
 * The first check, run just after a deploy is recorded. It waits for Sourcify to see the new
 * contract: up to about 45 seconds more per contract, which only the background check can afford.
 */
export const AFTER_DEPLOY: VerifyOptions = { bytecodeRetries: 3, retryMs: 10_000 };

/** Run verification for a stored deployment and save the result. */
export async function verifyDeployment(db: Db, d: Deployment, f: Fetch = fetch, opts: Omit<VerifyOptions, "identifier"> = {}): Promise<Deployment> {
  const out = d.proxy ? await verifyProxied(d, f, opts) : await verifyOnSourcify(d, f, opts);
  const [row] = await db
    .update(deployments)
    .set({
      verifyStatus: out.status,
      verifyProvider: "sourcify",
      verifyDetail: out.detail,
      verifiedAt: out.status === "verified" ? new Date() : null,
    })
    .where(eq(deployments.id, d.id))
    .returning();
  return row;
}
