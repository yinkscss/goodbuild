import { NextResponse } from "next/server";

import { verifyBody } from "@/lib/api-schemas";
import { errorResponse, requestDomain, setSessionCookie, takeNonceCookie } from "@/server/auth/http";
import { AuthError } from "@/server/auth/errors";
import { assertMagicLogin } from "@/server/auth/magic";
import { issueSession, publicUser, signInUser } from "@/server/auth/service";
import { verifySignIn } from "@/server/auth/siwe";
import { readNonceToken } from "@/server/auth/tokens";
import { getDb } from "@/server/db/client";
import { creditPendingForWallet } from "@/server/credits/onchain";

/**
 * Verify a signed EIP-4361 message and start a session (AUTH.md Flow 4).
 * The nonce cookie is consumed whether or not verification succeeds.
 */
export async function POST(request: Request) {
  try {
    const parsed = verifyBody.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AuthError("message_invalid");
    const body = parsed.data;

    const expectedNonce = await readNonceToken(await takeNonceCookie());
    const { address, chainId } = await verifySignIn({
      message: body.message,
      signature: body.signature as `0x${string}`,
      expectedNonce,
      expectedDomain: await requestDomain(),
    });

    // Email wallets (Magic, D22) must also present a DID token for this exact sign-in.
    if (body.walletKind === "embedded") assertMagicLogin({ didToken: body.didToken, message: body.message, address });

    const db = await getDb();
    const user = await signInUser(db, { wallet: address, walletKind: body.walletKind, attestation: body.attestation });
    // Credits redeemed on-chain before this wallet had an account land now. Never blocks sign-in.
    await creditPendingForWallet(db, user.wallet).catch((e) => console.error("[credits] pending credit failed", e));
    await setSessionCookie(await issueSession(db, user, chainId));
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
