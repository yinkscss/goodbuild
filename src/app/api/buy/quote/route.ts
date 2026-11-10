import { NextResponse, connection } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { GoodCashError, MAX_NAIRA, MIN_NAIRA, topUpQuote } from "@/server/goodcash/client";

const NO_STORE = { "Cache-Control": "no-store" };
const query = z.object({ amountNaira: z.coerce.number().int().min(MIN_NAIRA).max(MAX_NAIRA), asset: z.enum(["g", "celo"]) });

/** What the signed-in person gets for this much naira, with every fee on its own line. A quote is good for about 30 seconds. */
export async function GET(request: Request) {
  await connection();
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const parsed = query.safeParse({ amountNaira: url.searchParams.get("amountNaira"), asset: url.searchParams.get("asset") ?? "g" });
    if (!parsed.success) return NextResponse.json({ error: "invalid_query", message: `Pick an amount from ₦${MIN_NAIRA.toLocaleString("en-US")} to ₦${MAX_NAIRA.toLocaleString("en-US")}.` }, { status: 400, headers: NO_STORE });
    const quote = await topUpQuote({ ...parsed.data, wallet: session.user.wallet });
    return NextResponse.json(quote, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof GoodCashError) return NextResponse.json({ error: error.code, message: error.message }, { status: error.status, headers: NO_STORE });
    return errorResponse(error);
  }
}
