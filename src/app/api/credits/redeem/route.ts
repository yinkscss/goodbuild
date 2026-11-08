import { NextResponse, connection } from "next/server";
import { z } from "zod";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { creditsClient, creditsChain } from "@/server/credits/chain-client";
import { CreditsNotConfiguredError, redeemFromReceipt } from "@/server/credits/onchain";
import { getBalanceMicro } from "@/server/credits/ledger";

const body = z.object({ chainId: z.number().int(), txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) });
const NO_STORE = { "Cache-Control": "no-store" };

/**
 * "I redeemed on-chain": reads the transaction and credits what the contract says was burned (D52).
 * It never trusts the caller about who or how much. A transaction that isn't mined yet answers 202 so the screen retries.
 */
export async function POST(request: Request) {
  await connection();
  try {
    const session = await requireSession();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !creditsChain(parsed.data.chainId)) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
    const db = await getDb();
    let result;
    try {
      result = await redeemFromReceipt(db, creditsClient(parsed.data.chainId), parsed.data.chainId, parsed.data.txHash as `0x${string}`);
    } catch (error) {
      if (error instanceof CreditsNotConfiguredError) return NextResponse.json({ error: "not_live", message: "Credits aren't live on that network yet." }, { status: 409, headers: NO_STORE });
      if ((error as Error).name === "TransactionReceiptNotFoundError") return NextResponse.json({ pending: true }, { status: 202, headers: NO_STORE });
      throw error;
    }
    const balanceMicro = await getBalanceMicro(db, session.user.id);
    return NextResponse.json({ ...result, balanceMicro }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
