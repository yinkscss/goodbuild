import { NextResponse } from "next/server";
import { requireSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { ambassadorDashboard, repairAmbassadorEarnings, AmbassadorError, requestPayout } from "@/server/ambassador/service";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    const page = Math.max(0, Math.min(100000, Number(new URL(request.url).searchParams.get("page")) || 0));
    const db = await getDb();
    await repairAmbassadorEarnings(db, s.user.id, Math.floor(page));
    return NextResponse.json(await ambassadorDashboard(db, s.user.id, Math.floor(page)), { headers });
  } catch (e) { return errorResponse(e); }
}
export async function POST() {
  try {
    const s = await requireSession();
    return NextResponse.json(await requestPayout(await getDb(), s.user.id), { headers });
  } catch (e) {
    if (e instanceof AmbassadorError) return NextResponse.json({ message: e.message }, { status: 409, headers });
    return errorResponse(e);
  }
}
