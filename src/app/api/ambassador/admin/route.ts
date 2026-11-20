import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { isAdminWallet } from "@/server/settings/mainnet-access";
import { ambassadorDashboard, adminAmbassadors, payoutQueue, payoutAudit, changePayout, confirmPayout, AmbassadorError } from "@/server/ambassador/service";
import type { Hex } from "viem";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    if (!isAdminWallet(s.user.wallet)) return new NextResponse(null, { status: 404 });
    const q = new URL(request.url).searchParams;
    const page = Math.floor(Math.max(0, Math.min(100000, Number(q.get("page")) || 0)));
    const db = await getDb();
    const userId = q.get("userId");
    if (userId && !z.uuid().safeParse(userId).success) return new NextResponse(null, { status: 400 });
    return NextResponse.json(userId ? { detail: await ambassadorDashboard(db, userId, page, true), audit: await payoutAudit(db, userId) } : { ambassadors: await adminAmbassadors(db, q.get("wallet") ?? undefined, page), queue: await payoutQueue(db, page) }, { headers });
  } catch (e) { return errorResponse(e); }
}
const bodySchema = z.object({ id: z.uuid(), action: z.enum(["process", "reject", "reconcile", "confirm"]), reason: z.string().trim().max(2000).optional(), hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional() });
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    if (!isAdminWallet(s.user.wallet)) return new NextResponse(null, { status: 404 });
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return NextResponse.json({ message: "Invalid payout action." }, { status: 400 });
    const b = body.data;
    if (b.action === "confirm") {
      if (!b.hash) throw new AmbassadorError("Enter the payment transaction hash.");
      await confirmPayout(await getDb(), s.user.id, b.id, b.hash as Hex);
    } else await changePayout(await getDb(), s.user.id, b.id, b.action, b.reason);
    return NextResponse.json({ ok: true }, { headers });
  } catch (e) {
    if (e instanceof AmbassadorError) return NextResponse.json({ message: e.message }, { status: 409, headers });
    return errorResponse(e);
  }
}
