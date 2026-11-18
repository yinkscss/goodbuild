import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { FreeGrantError, claimWelcome, freePolicy } from "@/server/credits/free-grants";
import { getDb } from "@/server/db/client";
import { readGoodIdentityOnCelo, syncGoodId } from "@/server/goodid";

/**
 * Check the signed-in wallet against GoodDollar's Identity contract. Once it's verified, the welcome
 * credits are posted (D123), once per GoodDollar identity, so verifying is all a person has to do.
 * A failed grant never hides the verification: it's reported beside it.
 */
export async function POST() {
  try {
    const session = await requireSession();
    const db = await getDb();
    let verified: boolean;
    try {
      verified = await syncGoodId(db, session.user);
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "chain_unavailable", message: "We couldn't reach Celo to check that. Try again in a moment." }, { status: 503 });
    }
    let welcomeMicro = 0;
    let welcomeError: string | undefined;
    if (verified && freePolicy(process.env) === "verified") {
      try {
        welcomeMicro = (await claimWelcome(db, session.user, { readIdentity: readGoodIdentityOnCelo })).grantedMicro;
      } catch (error) {
        if (error instanceof FreeGrantError) welcomeError = error.message;
        else {
          console.error("welcome grant failed", error);
          welcomeError = "You're verified, but we couldn't add your free credits yet. Try again in a moment.";
        }
      }
    }
    return NextResponse.json({ verified, welcomeMicro, ...(welcomeError ? { welcomeError } : {}) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
