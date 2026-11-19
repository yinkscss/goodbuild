import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { referralSummary } from "@/server/hackathon/referrals";

/** The signed-in builder's invite code and how their invites are doing (D136). Null until they register. */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await referralSummary(await getDb(), session.user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
