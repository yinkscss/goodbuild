import { NextResponse } from "next/server";
import { z } from "zod";

import { getPreferences, setPreferences } from "@/server/account/preferences";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";

const headers = { "Cache-Control": "no-store, private" };
const body = z.object({ showBadge: z.boolean() }).strict();

/** The signed-in user's own settings. Never another user's. */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await getPreferences(await getDb(), session.user.id), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireSession();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Send showBadge as true or false." }, { status: 400, headers });
    return NextResponse.json(await setPreferences(await getDb(), session.user.id, parsed.data), { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
