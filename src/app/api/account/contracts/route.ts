import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { listContracts } from "@/server/account/overview";
import { getDb } from "@/server/db/client";

/** The signed-in user's deployed contracts, with whether each is the live one. Never another user's. */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ contracts: await listContracts(await getDb(), session.user.id) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return errorResponse(error);
  }
}
