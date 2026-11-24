import { NextResponse } from "next/server";
import type { Address } from "viem";
import { celo } from "viem/chains";
import { currentSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot, recordingRootReader } from "@/server/goodid";
import { voteStatus } from "@/server/hackathon/community";

/** The signed-in person's vote steps and approvals used (D155). Signed out: nothing is done or used. */
export async function GET() {
  try {
    const session = await currentSession();
    const client = publicClientFor(celo.id);
    const db = await getDb();
    // Recording the root means someone already verified with GoodDollar is counted, though they never press Verify.
    const readRoot = session ? recordingRootReader(db, session.user, client) : (wallet: Address) => readGoodIdRoot(client, wallet);
    return NextResponse.json(
      await voteStatus(db, session?.user ?? null, readRoot),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
