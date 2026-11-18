import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { FreeGrantError, claimRefill } from "@/server/credits/free-grants";
import { getDb } from "@/server/db/client";
import { readGoodIdentityOnCelo } from "@/server/goodid";

const NO_STORE = { "Cache-Control": "no-store" };

/** Claim today's refill (D112). The chain is read again before anything is paid. */
export async function POST() {
  try {
    const session = await requireSession();
    try {
      const result = await claimRefill(await getDb(), session.user, { readIdentity: readGoodIdentityOnCelo });
      return NextResponse.json(result, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof FreeGrantError) {
        const status = error.code === "not_verified" || error.code === "expired" ? 403 : error.code === "budget_full" || error.code === "off" ? 410 : 409;
        return NextResponse.json({ error: error.code, message: error.message }, { status, headers: NO_STORE });
      }
      if (error instanceof Error && /fetch|network|timeout|rpc/i.test(error.message)) {
        console.error(error);
        return NextResponse.json({ error: "chain_unavailable", message: "We couldn't reach Celo to check that. Try again in a moment." }, { status: 503, headers: NO_STORE });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
