import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { freeStatus } from "@/server/credits/free-grants";
import { getDb } from "@/server/db/client";

/** Where the signed-in person stands with free credits (D112): verified, welcome, refills. No chain read. */
export async function GET() {
  try {
    const session = await requireSession();
    const status = await freeStatus(await getDb(), session.user.id);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
