import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { freeStatus } from "@/server/credits/free-grants";
import { getDb } from "@/server/db/client";
import { readUbiClaimedAtOnCelo } from "@/server/goodid";

/** Where the signed-in person stands with free credits (D123): verified, welcome, refills, and whether today's G$ UBI is claimed. */
export async function GET() {
  try {
    const session = await requireSession();
    const status = await freeStatus(await getDb(), session.user.id, new Date(), process.env, readUbiClaimedAtOnCelo);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
