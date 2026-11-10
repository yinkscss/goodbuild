import { NextResponse, connection } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { GoodCashError, getTopUp, topUpBelongsTo } from "@/server/goodcash/client";

const NO_STORE = { "Cache-Control": "no-store" };

/** A top-up's status, only for the wallet it pays. Anyone else gets "not found". */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  await connection();
  try {
    const session = await requireSession();
    const { id } = await params;
    const topUp = await getTopUp(id);
    if (!topUpBelongsTo(topUp, session.user.wallet)) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ id: topUp.id, status: topUp.status, asset: topUp.asset, amountNaira: topUp.amountNaira, txHash: topUp.txHash ?? null, test: topUp.mode === "test" }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GoodCashError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.code === "bad_request" ? 404 : error.status, headers: NO_STORE });
    return errorResponse(error);
  }
}
