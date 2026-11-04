import { NextResponse } from "next/server";

import { verifyBody } from "@/lib/api-schemas";
import { errorResponse, requestDomain, setSessionCookie, takeNonceCookie } from "@/server/auth/http";
import { AuthError } from "@/server/auth/errors";
import { issueSession, publicUser, signInUser } from "@/server/auth/service";
import { verifySignIn } from "@/server/auth/siwe";
import { readNonceToken } from "@/server/auth/tokens";
import { getDb } from "@/server/db/client";

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

    const db = await getDb();
    const user = await signInUser(db, { wallet: address, walletKind: body.walletKind, attestation: body.attestation });
    await setSessionCookie(await issueSession(db, user, chainId));
    return NextResponse.json({ user: publicUser(user) });
  } catch (error) {
    return errorResponse(error);
  }
}
