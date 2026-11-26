import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { ACCOUNT_NUMBER, ATTEMPT_KEY, cashOutInfo, startCashOut, verifyAccount } from "@/server/ambassador/cashout";
import { fail, headers } from "./_respond";

// GET /api/ambassador/cashout?payoutId=… → banks, limits and the live Naira amount for one paid payout.
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    const payoutId = z.uuid().safeParse(new URL(request.url).searchParams.get("payoutId"));
    if (!payoutId.success) return NextResponse.json({ message: "Pick a payout." }, { status: 400, headers });
    return NextResponse.json(await cashOutInfo(await getDb(), s.user, payoutId.data), { headers });
  } catch (e) { return fail(e); }
}

const account = { bankCode: z.string().trim().min(2).max(20), accountNumber: z.string().regex(ACCOUNT_NUMBER) };
const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("verify"), ...account }),
  z.object({ action: z.literal("start"), payoutId: z.uuid(), ...account, feePercentShown: z.number().finite().min(0).max(100), attemptKey: z.string().regex(ATTEMPT_KEY) }),
]);

// POST /api/ambassador/cashout { action: "verify" | "start" }. The wallet is always the signed-in session's, never one the browser names.
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    const b = body.safeParse(await request.json().catch(() => null));
    if (!b.success) return NextResponse.json({ message: "Check the bank and the 10-digit account number." }, { status: 400, headers });
    if (b.data.action === "verify") return NextResponse.json({ accountName: await verifyAccount(b.data.bankCode, b.data.accountNumber) }, { headers });
    const { payoutId, bankCode, accountNumber, feePercentShown, attemptKey } = b.data;
    return NextResponse.json(await startCashOut(await getDb(), s.user, { payoutId, bankCode, accountNumber, feePercentShown, attemptKey }), { status: 201, headers });
  } catch (e) { return fail(e); }
}
