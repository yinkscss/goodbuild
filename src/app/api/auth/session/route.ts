import { NextResponse, connection } from "next/server";

import { currentSession, errorResponse } from "@/server/auth/http";
import { publicUser } from "@/server/auth/service";

/** The signed-in user, or 401. Rotates the cookie when it's due. */
export async function GET() {
  await connection();
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ user: null }, { status: 401, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json(
      { user: publicUser(session.user), chainId: session.chainId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
