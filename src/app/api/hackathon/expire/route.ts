import { NextResponse, connection } from "next/server";

import { currentSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { CLAIMS_CLOSE } from "@/server/hackathon/claim";
import { expireUnusedCredits } from "@/server/hackathon/admin";
import { isAdminWallet } from "@/server/settings/mainnet-access";

const NO_STORE = { "Cache-Control": "no-store" };

/** Remove unspent hackathon credits after the deadline (D100). Admins only; safe to run again. */
export async function POST() {
  await connection();
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    if (!isAdminWallet(session.user.wallet)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    if (new Date() < CLAIMS_CLOSE) return NextResponse.json({ error: "not_closed", message: "Claims haven't closed yet." }, { status: 409, headers: NO_STORE });
    return NextResponse.json(await expireUnusedCredits(await getDb()), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
