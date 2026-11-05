import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { deployments, type Deployment } from "@/server/db/deploy-schema";

/** Sourcify's public server. It lists both Celo chains as supported (checked 5 Nov 2026). */
export const SOURCIFY_URL = process.env.SOURCIFY_URL ?? "https://sourcify.dev/server";

type Fetch = typeof fetch;

export interface VerifyOutcome {
  status: "verified" | "pending" | "failed" | "unsupported";
  detail: string;
}

/** Fully qualified name of the deployed contract inside the standard JSON input. */
function identifier(d: Deployment): string | null {
  const sources = (d.stdJsonInput as { sources?: Record<string, unknown> } | null)?.sources ?? {};
  const file = Object.keys(sources).find((p) => p.startsWith("contracts/") && p === `contracts/${d.contractName}.sol`);
  return file ? `${file}:${d.contractName}` : null;
}

/**
 * Submit to Sourcify (D17: Sourcify first, Celoscan later) and wait briefly for the verdict.
 * A job that is still running returns "pending"; call again later. Sourcify forwards verified
 * contracts to Blockscout and Etherscan-style explorers on its own.
 */
export async function verifyOnSourcify(d: Deployment, f: Fetch = fetch, opts: { pollMs?: number; polls?: number } = {}): Promise<VerifyOutcome> {
  const id = identifier(d);
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
  if (!res.ok) return { status: "failed", detail: await message(res) };
  const { verificationId } = (await res.json()) as { verificationId?: string };
  if (!verificationId) return { status: "failed", detail: "Sourcify didn't accept the request." };

  for (let i = 0; i < polls; i++) {
    await new Promise((r) => setTimeout(r, pollMs));
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
    return { status: "failed", detail: body.error?.message ?? "Sourcify couldn't match the bytecode." };
  }
  return { status: "pending", detail: "Sourcify is still checking." };
}

async function message(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: string; customCode?: string };
    return body.message ?? body.customCode ?? `Sourcify answered ${res.status}.`;
  } catch {
    return `Sourcify answered ${res.status}.`;
  }
}

/** Run verification for a stored deployment and save the result. */
export async function verifyDeployment(db: Db, d: Deployment, f: Fetch = fetch): Promise<Deployment> {
  const out = await verifyOnSourcify(d, f);
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
