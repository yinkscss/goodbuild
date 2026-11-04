import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/server/auth/config";
import { clearSessionCookie, errorResponse } from "@/server/auth/http";
import { revokeSession } from "@/server/auth/service";
import { getDb } from "@/server/db/client";

/** Revoke the session server-side and clear the cookie. */
export async function POST() {
  try {
    const token = (await cookies()).get(SESSION_COOKIE)?.value;
    await revokeSession(await getDb(), token);
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
