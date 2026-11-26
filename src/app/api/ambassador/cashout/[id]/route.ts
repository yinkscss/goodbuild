import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { refreshCashOut, reportCashOutTx } from "@/server/ambassador/cashout";
import { fail, headers } from "../_respond";

type Ctx = { params: Promise<{ id: string }> };

// GET → the latest status, straight from GoodCash (so it works even if a webhook is late).
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const s = await requireSession();
    const id = z.uuid().safeParse((await params).id);
    if (!id.success) return new NextResponse(null, { status: 404 });
    return NextResponse.json({ cashOut: await refreshCashOut(await getDb(), s.user.id, id.data) }, { headers });
  } catch (e) { return fail(e); }
}

// POST { txHash } → the wallet sent the transfer; tell GoodCash which one.
export async function POST(request: Request, { params }: Ctx) {
  try {
    const s = await requireSession();
    const id = z.uuid().safeParse((await params).id);
    const b = z.object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).safeParse(await request.json().catch(() => null));
    if (!id.success || !b.success) return NextResponse.json({ message: "Invalid request." }, { status: 400, headers });
    return NextResponse.json({ cashOut: await reportCashOutTx(await getDb(), s.user.id, id.data, b.data.txHash) }, { headers });
  } catch (e) { return fail(e); }
}
