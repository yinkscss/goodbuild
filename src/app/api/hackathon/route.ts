import type { Address } from "viem";
import {
  confirmExistingFlowstateSupport,
  FlowstateError,
} from "@/server/flowstate/service";
import { NextResponse } from "next/server";
import { celo } from "viem/chains";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot } from "@/server/goodid";
import {
  HackathonError,
  claimHackathon,
  hackathonStatus,
} from "@/server/hackathon/claim";

import { getParticipant } from "@/server/hackathon/community";

const NO_STORE = { "Cache-Control": "no-store" };

/** The signed-in person's hackathon registration and credits (D99). */
export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json(
      await hackathonStatus(await getDb(), session.user.id),
      { headers: NO_STORE },
    );
  } catch (error) {
    return errorResponse(error);
  }
}

/** Register for the hackathon and collect any credits that are due. Safe to repeat. */
export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const db = await getDb();
    const participant = await getParticipant(db, session.user.id);
    if (!participant)
      return NextResponse.json(
        { message: "Save your signup email before claiming credits." },
        { status: 400, headers: NO_STORE },
      );
    const client = publicClientFor(celo.id);
    try {
      const current = await hackathonStatus(db, session.user.id);
      // The vote unlocks the initial grant. The deploy tranche is already earned on registration.
      if (!current.registered) {
        if (participant.flowstate !== "voted")
          return NextResponse.json(
            {
              error: "flowstate_required",
              message:
                "Complete your GoodBuildIt vote in step 3 before claiming free credits.",
            },
            { status: 403, headers: NO_STORE },
          );
        const support = await confirmExistingFlowstateSupport(
          client,
          session.user.wallet as Address,
        );
        if (!support.verified || BigInt(support.support) <= BigInt(0))
          return NextResponse.json(
            {
              error: "flowstate_required",
              message:
                "Your wallet needs confirmed support for GoodBuildIt before claiming free credits.",
            },
            { status: 403, headers: NO_STORE },
          );
      }
      // An invite code may come with the call. A missing body, bad JSON or a bad code changes nothing (D136).
      const body = (await request.json().catch(() => null)) as { ref?: unknown } | null;
      const status = await claimHackathon(await getDb(), session.user, {
        readRoot: (wallet) => readGoodIdRoot(client, wallet),
        ref: body?.ref,
      });
      return NextResponse.json(status, { headers: NO_STORE });
    } catch (error) {
      if (error instanceof FlowstateError)
        return NextResponse.json(
          { error: "flowstate_required", message: error.message },
          { status: error.status, headers: NO_STORE },
        );
      if (error instanceof HackathonError) {
        const status =
          error.code === "not_verified"
            ? 403
            : error.code === "claimed_elsewhere"
              ? 409
              : 410;
        return NextResponse.json(
          { error: error.code, message: error.message },
          { status, headers: NO_STORE },
        );
      }
      if (
        error instanceof Error &&
        /fetch|network|timeout|rpc/i.test(error.message)
      ) {
        console.error(error);
        return NextResponse.json(
          {
            error: "chain_unavailable",
            message:
              "We couldn't reach Celo to check that. Try again in a moment.",
          },
          { status: 503, headers: NO_STORE },
        );
      }
      throw error;
    }
  } catch (error) {
    return errorResponse(error);
  }
}
