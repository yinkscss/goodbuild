import { NextResponse } from "next/server";
import { celo } from "viem/chains";
import { currentSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot } from "@/server/goodid";
import { voteStatus } from "@/server/hackathon/community";

/** The signed-in person's vote steps and approvals used (D132). Signed out: nothing is done or used. */
export async function GET() {
  try {
    const session = await currentSession();
    const client = publicClientFor(celo.id);
    return NextResponse.json(
      await voteStatus(await getDb(), session?.user ?? null, (wallet) =>
        readGoodIdRoot(client, wallet),
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
