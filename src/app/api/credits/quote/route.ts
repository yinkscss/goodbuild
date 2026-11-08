import { NextResponse, connection } from "next/server";
import { celo } from "viem/chains";
import { z } from "zod";

import { currentSession, errorResponse, requireSession } from "@/server/auth/http";
import { creditsChain } from "@/server/credits/chain-client";
import { PACKS, QuoteError, issueQuote, previewPacks } from "@/server/credits/quote";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot, syncGoodId } from "@/server/goodid";

const NO_STORE = { "Cache-Control": "no-store" };
const STATUS = { price_unavailable: 503, signer_not_configured: 503, not_live: 409, bad_pack: 400 } as const;

/**
 * The GoodDollar verification check behind the bonus (D56). The chain decides, never the browser: the
 * wallet is asked of GoodDollar's Identity contract on Celo mainnet. A wallet linked to a verified one
 * counts as that person, so the bonus is counted per person (the whitelisted root), not per wallet.
 * A failed read means no bonus, never an error: a bonus is a gift, not something a purchase may wait on.
 */
async function verifiedRoot(db: Awaited<ReturnType<typeof getDb>>, user: { id: string; wallet: string; verifiedAt: Date | null }) {
  try {
    const root = await readGoodIdRoot(publicClientFor(celo.id), user.wallet as `0x${string}`);
    if (root) await syncGoodId(db, user);
    return root ? root.toLowerCase() : null;
  } catch (error) {
    console.error("goodid read failed", error);
    return null;
  }
}

/** Packs, prices in G$ and the bonus this person would get. Works signed out (no bonus shown, only the possible one). */
export async function GET() {
  await connection();
  try {
    const db = await getDb();
    const session = await currentSession().catch(() => null);
    const root = session ? await verifiedRoot(db, session.user) : null;
    const preview = await previewPacks(db, { root });
    return NextResponse.json({ gdUsd: preview.gdUsd, verified: Boolean(root), packs: preview.packs }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof QuoteError) return NextResponse.json({ error: error.code, message: error.message }, { status: STATUS[error.code], headers: NO_STORE });
    return errorResponse(error);
  }
}

const body = z.object({ chainId: z.number().int(), pack: z.number().int() });

/** A signed, 10 minute quote for one pack. Pay it with G$ `transferAndCall` to the credits contract. */
export async function POST(request: Request) {
  await connection();
  try {
    const session = await requireSession();
    const parsed = body.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !creditsChain(parsed.data.chainId) || !(PACKS as readonly number[]).includes(parsed.data.pack)) return NextResponse.json({ error: "invalid_body" }, { status: 400, headers: NO_STORE });
    const db = await getDb();
    const root = await verifiedRoot(db, session.user);
    const signed = await issueQuote(db, { userId: session.user.id, wallet: session.user.wallet, chainId: parsed.data.chainId, pack: parsed.data.pack, root });
    return NextResponse.json(signed, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof QuoteError) return NextResponse.json({ error: error.code, message: error.message }, { status: STATUS[error.code], headers: NO_STORE });
    return errorResponse(error);
  }
}
