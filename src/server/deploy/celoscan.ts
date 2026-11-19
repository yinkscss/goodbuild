import "server-only";

import { CELO_MAINNET_ID } from "@/config/gooddollar";
import type { Deployment } from "@/server/db/deploy-schema";

/** Etherscan's v2 multichain API. One key covers Celo (chain 42220). */
export const ETHERSCAN_V2_URL = process.env.ETHERSCAN_V2_URL ?? "https://api.etherscan.io/v2/api";

type Fetch = typeof fetch;

export interface CeloscanOutcome {
  status: "verified" | "pending" | "failed" | "skipped";
  detail: string;
}

interface Target {
  address: string;
  identifier: string;
  constructorArgs: string;
}

const SKIPPED = (detail: string): CeloscanOutcome => ({ status: "skipped", detail });

/** Fully qualified name of the deployed contract inside the standard JSON input. */
function identifierOf(d: Pick<Deployment, "stdJsonInput" | "contractName">): string | null {
  const sources = (d.stdJsonInput as { sources?: Record<string, unknown> } | null)?.sources ?? {};
  const file = `contracts/${d.contractName}.sol`;
  return file in sources ? `${file}:${d.contractName}` : null;
}

async function submit(t: Target, d: Pick<Deployment, "stdJsonInput" | "compilerVersion">, key: string, f: Fetch, sleep: (ms: number) => Promise<void>, polls: number): Promise<CeloscanOutcome> {
  const url = `${ETHERSCAN_V2_URL}?chainid=${CELO_MAINNET_ID}`;
  const form = new URLSearchParams({
    apikey: key,
    module: "contract",
    action: "verifysourcecode",
    contractaddress: t.address,
    sourceCode: JSON.stringify(d.stdJsonInput),
    codeformat: "solidity-standard-json-input",
    contractname: t.identifier,
    compilerversion: `v${d.compilerVersion}`,
    constructorArguments: t.constructorArgs.replace(/^0x/, ""),
  });
  let res: Response;
  try {
    res = await f(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
  } catch {
    return { status: "pending", detail: "Celoscan couldn't be reached." };
  }
  if (!res.ok) return { status: "pending", detail: `Celoscan answered ${res.status}.` };
  const body = (await res.json().catch(() => ({}))) as { status?: string; result?: string; message?: string };
  if (/already verified/i.test(body.result ?? "")) return { status: "verified", detail: "Already verified on Celoscan." };
  if (body.status !== "1" || !body.result) {
    // "Unable to locate ContractCode" means the explorer hasn't indexed the new contract yet.
    const notYet = /unable to locate|not (yet )?(found|indexed)/i.test(body.result ?? "");
    return { status: notYet ? "pending" : "failed", detail: body.result ?? body.message ?? "Celoscan didn't accept the request." };
  }
  const guid = body.result;
  for (let i = 0; i < polls; i++) {
    await sleep(3000);
    let poll: Response;
    try {
      poll = await f(`${url}&module=contract&action=checkverifystatus&guid=${encodeURIComponent(guid)}&apikey=${encodeURIComponent(key)}`);
    } catch {
      continue;
    }
    if (!poll.ok) continue;
    const out = (await poll.json().catch(() => ({}))) as { result?: string };
    const r = out.result ?? "";
    if (/pass|verified/i.test(r) && !/fail/i.test(r)) return { status: "verified", detail: "Verified on Celoscan." };
    if (/pending|queue/i.test(r)) continue;
    return { status: /already verified/i.test(r) ? "verified" : "failed", detail: r || "Celoscan couldn't match the code." };
  }
  return { status: "pending", detail: "Celoscan is still checking." };
}

/**
 * Submit a mainnet deployment to Celoscan (D132). Best effort: it never changes the Sourcify result, and
 * with no key or on testnet it does nothing. A proxied contract submits its current code.
 */
export async function verifyOnCeloscan(
  d: Deployment,
  f: Fetch = fetch,
  opts: { key?: string; sleep?: (ms: number) => Promise<void>; polls?: number } = {},
): Promise<CeloscanOutcome> {
  const key = opts.key ?? process.env.ETHERSCAN_API_KEY;
  if (d.chainId !== CELO_MAINNET_ID) return SKIPPED("Celoscan is for Celo mainnet only.");
  if (!key) return SKIPPED("No Celoscan key is set.");
  const id = identifierOf(d);
  if (!d.stdJsonInput || !id) return { status: "failed", detail: "The sources for this deployment weren't saved." };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const polls = opts.polls ?? 6;
  // A proxied contract (D33): submit the current code. The proxy's own constructor arguments aren't stored, and
  // Etherscan-style explorers usually match OpenZeppelin's standard proxy on their own.
  const targets: Target[] = [{ address: d.proxy ? d.proxy.implementation : d.address, identifier: id, constructorArgs: d.constructorArgs }];
  let worst: CeloscanOutcome = { status: "verified", detail: "Verified on Celoscan." };
  const rank = ["failed", "pending", "verified"];
  for (const t of targets) {
    const out = await submit(t, d, key, f, sleep, polls);
    if (rank.indexOf(out.status) < rank.indexOf(worst.status)) worst = out;
  }
  return worst;
}
