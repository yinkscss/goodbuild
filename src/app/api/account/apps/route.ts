import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { listApps } from "@/server/account/overview";
import { getDb } from "@/server/db/client";

/** The signed-in user's apps with publish and data totals. Never another user's. */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ apps: await listApps(await getDb(), session.user.id) }, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return errorResponse(error);
  }
}
