import { NextResponse, connection } from "next/server";

import { requireSession } from "@/server/auth/http";
import { goodCashConfig, isTestKey } from "@/server/goodcash/client";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Whether Buy is switched on, and the publishable key the GoodCash widget needs. Read at request time, so no build argument.
 * `hostSigning` (GOODCASH_HOST_SIGNING=true) lets our page sign the top-up permit with the wallet the person is already
 * signed in with, so the widget skips its own connect screen (D120).
 */
export async function GET() {
  await connection();
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }
  const { publishableKey } = goodCashConfig();
  return NextResponse.json({ enabled: Boolean(publishableKey), publishableKey: publishableKey ?? null, test: isTestKey(publishableKey), hostSigning: process.env.GOODCASH_HOST_SIGNING === "true" }, { headers: NO_STORE });
}
