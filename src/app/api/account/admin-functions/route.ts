import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { listAdminFunctions } from "@/server/account/overview";
import { getDb } from "@/server/db/client";

/** Admin-style functions of the signed-in user's live contracts. Calls are signed in their own wallet, never here. */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ contracts: await listAdminFunctions(await getDb(), session.user.id), wallet: session.user.wallet }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return errorResponse(error);
  }
}
