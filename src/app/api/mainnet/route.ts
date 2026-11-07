import { NextResponse, connection } from "next/server";
import { z } from "zod";

import { currentSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { MAINNET_ACCESS_MODES, getMainnetMode, isAdminWallet, allowsMainnet, setMainnetMode } from "@/server/settings/mainnet-access";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Whether the viewer may start a new mainnet deploy right now (D50). One yes or no per viewer: the
 * setting itself and ADMIN_WALLETS stay on the server, except that an admin also sees the setting.
 */
export async function GET() {
  await connection();
  try {
    const session = await currentSession();
    const db = await getDb();
    const mode = await getMainnetMode(db);
    const wallet = session?.user.wallet ?? null;
    const admin = isAdminWallet(wallet);
    return NextResponse.json({ allowed: allowsMainnet(mode, wallet), ...(admin ? { admin: true, mode } : {}) }, { headers: NO_STORE });
  } catch (error) {
    // The kill switch fails shut: if anything goes wrong, the answer is no.
    console.error("mainnet access check failed", error);
    return NextResponse.json({ allowed: false }, { headers: NO_STORE });
  }
}

const body = z.object({ mode: z.enum(MAINNET_ACCESS_MODES) });

/** Change the switch. Only a wallet in ADMIN_WALLETS may, and it takes effect on the next request. */
export async function PUT(request: Request) {
  await connection();
  try {
    const session = await currentSession();
    if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
    if (!isAdminWallet(session.user.wallet)) return NextResponse.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
    await setMainnetMode(await getDb(), parsed.data.mode, session.user.wallet);
    return NextResponse.json({ mode: parsed.data.mode }, { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}
