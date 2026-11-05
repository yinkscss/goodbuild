import "server-only";

import { createPublicClient, getAddress, http, isAddressEqual, recoverMessageAddress, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage, verifySiweMessage } from "viem/siwe";

import { MESSAGE_MAX_AGE_SECONDS, MESSAGE_MAX_SKEW_SECONDS, SIGN_IN_CHAINS, SIGN_IN_CHAIN_IDS } from "./config";
import { AuthError } from "./errors";

export interface VerifySignInInput {
  message: string;
  signature: Hex;
  /** Nonce from the signed cookie (not from the message). */
  expectedNonce: string | null;
  /** Host the app is served from, e.g. "goodbuildit.xyz" or "localhost:3000". */
  expectedDomain: string;
  now?: Date;
  /**
   * Contract-wallet fallback (ERC-1271 / ERC-6492). Defaults to an RPC call on the
   * message's chain; injectable for tests.
   */
  verifyContractSignature?: (args: { message: string; signature: Hex; address: `0x${string}`; chainId: number }) => Promise<boolean>;
}

export interface VerifiedSignIn {
  address: `0x${string}`;
  chainId: number;
}

/**
 * Verify an EIP-4361 sign-in. Checks, in order: nonce present and matching, message
 * shape, domain, chain, timing, then the signature. EOAs (embedded and most external
 * wallets) are verified locally; anything else falls back to an on-chain check.
 */
export async function verifySignIn(input: VerifySignInInput): Promise<VerifiedSignIn> {
  const now = input.now ?? new Date();
  if (!input.expectedNonce) throw new AuthError("nonce_missing");

  const parsed = parseSiweMessage(input.message);
  if (!parsed.address || !parsed.chainId || !parsed.nonce || !parsed.domain || !parsed.issuedAt) {
    throw new AuthError("message_invalid");
  }
  if (parsed.nonce !== input.expectedNonce) throw new AuthError("nonce_mismatch");
  if (parsed.domain !== input.expectedDomain) throw new AuthError("domain_mismatch");
  if (!SIGN_IN_CHAIN_IDS.includes(parsed.chainId)) throw new AuthError("chain_unsupported");

  const issuedMs = parsed.issuedAt.getTime();
  if (issuedMs > now.getTime() + MESSAGE_MAX_SKEW_SECONDS * 1000) throw new AuthError("message_invalid");
  if (now.getTime() - issuedMs > MESSAGE_MAX_AGE_SECONDS * 1000) throw new AuthError("message_expired");
  if (!validateSiweMessage({ message: parsed, domain: input.expectedDomain, nonce: input.expectedNonce, time: now })) {
    throw new AuthError("message_expired");
  }

  const address = getAddress(parsed.address);
  let valid = false;
  try {
    const recovered = await recoverMessageAddress({ message: input.message, signature: input.signature });
    valid = isAddressEqual(recovered, address);
  } catch {
    valid = false;
  }
  if (!valid) {
    const check = input.verifyContractSignature ?? verifyOnChain;
    valid = await check({ message: input.message, signature: input.signature, address, chainId: parsed.chainId }).catch(
      () => false,
    );
  }
  if (!valid) throw new AuthError("signature_invalid");

  return { address, chainId: parsed.chainId };
}

async function verifyOnChain(args: { message: string; signature: Hex; address: `0x${string}`; chainId: number }) {
  const chain = SIGN_IN_CHAINS.find((c) => c.id === args.chainId);
  if (!chain) return false;
  const client = createPublicClient({ chain, transport: http() });
  return verifySiweMessage(client, { message: args.message, signature: args.signature, address: args.address });
}
