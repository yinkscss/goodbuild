import { NextResponse, connection } from "next/server";
import { generateSiweNonce } from "viem/siwe";

import { errorResponse, setNonceCookie } from "@/server/auth/http";
import { signNonceToken } from "@/server/auth/tokens";

/** Issue a single-use SIWE nonce, bound to a 5-minute signed httpOnly cookie. */
export async function GET() {
  // Never prerender or cache: every request must get a fresh nonce. Kept outside the
  // try so Next can stop the prerender here instead of our handler catching it.
  await connection();
  try {
    const nonce = generateSiweNonce();
    await setNonceCookie(await signNonceToken(nonce));
    return NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
