import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { attributeInvite, inviteSummary } from "@/server/referrals/referrals";

const headers = { "Cache-Control": "no-store" };

/** The signed-in person's invite code and how their invites are doing (D153). */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await inviteSummary(await getDb(), session.user.id), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}

/** The signed-in person came from a friend's link. A bad or useless code is not an error: it's just ignored. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const body = z.object({ code: z.string().max(40) }).safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ recorded: false }, { headers });
    return NextResponse.json(await attributeInvite(await getDb(), { code: body.data.code, refereeUserId: session.user.id }), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
