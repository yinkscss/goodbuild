import { NextResponse } from "next/server";
import { celo } from "viem/chains";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot } from "@/server/goodid";
import { HackathonError, claimHackathon, hackathonStatus } from "@/server/hackathon/claim";

const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in person's hackathon registration and credits (D99). */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(await hackathonStatus(await getDb(), session.user.id), { headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Register for the hackathon and collect any credits that are due. Safe to repeat. */
export async function POST() {
  try {
    const session = await requireSession();
    const client = publicClientFor(celo.id);
    try {
      const status = await claimHackathon(await getDb(), session.user, { readRoot: (wallet) => readGoodIdRoot(client, wallet) });
      return NextResponse.json(status, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof HackathonError) {
        const status = error.code === "not_verified" ? 403 : error.code === "claimed_elsewhere" ? 409 : 410;
        return NextResponse.json({ error: error.code, message: error.message }, { status, headers: NO_STORE });
      }
      if (error instanceof Error && /fetch|network|timeout|rpc/i.test(error.message)) {
        console.error(error);
        return NextResponse.json({ error: "chain_unavailable", message: "We couldn't reach Celo to check that. Try again in a moment." }, { status: 503, headers: NO_STORE });
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
