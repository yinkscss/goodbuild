import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { syncGoodId } from "@/server/goodid";

/** Check the signed-in wallet against GoodDollar's Identity contract. */
export async function POST() {
  try {
    const session = await requireSession();
    let verified: boolean;
    try {
      verified = await syncGoodId(await getDb(), session.user);
    } catch (error) {
      console.error(error);
      return NextResponse.json({ error: "chain_unavailable", message: "We couldn't reach Celo to check that. Try again in a moment." }, { status: 503 });
    }
    return NextResponse.json({ verified }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
