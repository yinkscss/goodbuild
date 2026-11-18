import "server-only";

import { readFileSync } from "node:fs";
import { createPublicClient, http, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

import { sendTelegram } from "@/server/support/ticket";

import { viemGrantChain, type GrantDeps, type GrantSigner } from "./grant";

/**
 * The gas wallet's key lives in a file mounted read-only into the web container (MAINNET_PLAN.md section 7
 * point 8), never in process.env, so it isn't handed to child processes or printed with the environment.
 * GAS_WALLET_KEY_FILE names the file; it holds the 0x-prefixed key and nothing else.
 */
export const DEFAULT_KEY_FILE = "/run/secrets/gas_wallet_key";

let cached: GrantSigner | null | undefined;

export function loadGasSigner(path = process.env.GAS_WALLET_KEY_FILE || DEFAULT_KEY_FILE): GrantSigner | null {
  if (cached !== undefined) return cached;
  let key: string;
  try {
    key = readFileSync(path, "utf8").trim();
  } catch {
    cached = null; // Not installed: grants are off. Not logged as an error, since dev has no key.
    return cached;
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.error("[gas-grant] key file is not a 0x-prefixed 32-byte key; grants are off");
    cached = null;
    return cached;
  }
  const account = privateKeyToAccount(key as `0x${string}`);
  cached = { address: account.address, signTransaction: (tx) => account.signTransaction(tx) };
  return cached;
}

export function gasGrantDeps(): GrantDeps {
  return {
    chain: viemGrantChain(createPublicClient({ chain: celo, transport: http(process.env.CELO_RPC_URL || undefined) }) as PublicClient),
    signer: loadGasSigner(),
    // The owner's support Telegram chat (same bot as support tickets). No new bot, no extra email.
    alert: async (text) => {
      const sent = await sendTelegram(text, process.env, fetch);
      if (!sent) console.error("[gas-grant] owner alert not delivered:", text);
    },
  };
}
