import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { AuthError } from "@/server/auth/errors";
import { requireSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { hackathonParticipants } from "@/server/db/hackathon-schema";
import { publicClientFor } from "@/server/deploy/service";
import { FLOWSTATE_CHAIN_ID } from "@/lib/flowstate/config";
import {
  flowstateStatus,
  prepareFlowstateVote,
  confirmFlowstateVote,
  confirmExistingFlowstateSupport,
  FlowstateError,
} from "@/server/flowstate/service";
import { claimFlowstateEligibility } from "@/server/flowstate/eligibility";
import { getParticipant, saveParticipant } from "@/server/hackathon/community";
import { HACKATHON_ID } from "@/server/hackathon/claim";
const headers = { "Cache-Control": "no-store" };
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("eligibility"),
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
    issuedAt: z.number().int(),
  }),
  z.object({
    action: z.literal("prepare"),
    additional: z.string().regex(/^[1-9]\d{0,28}$/),
  }),
  z.object({ action: z.literal("existing") }),
  z.object({
    action: z.literal("confirm"),
    hash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  }),
]);
function failure(e: unknown) {
  if (e instanceof FlowstateError)
    return NextResponse.json(
      { message: e.message },
      { status: e.status, headers },
    );
  if (e instanceof AuthError) return errorResponse(e);
  console.error(
    "[flowstate] operation failed",
    e instanceof Error ? e.name : "unknown",
  );
  return NextResponse.json(
    {
      message:
        "We couldn’t reach FlowState or Celo. Please try again in a moment.",
    },
    { status: 503, headers },
  );
}
export async function GET() {
  try {
    const s = await requireSession();
    return NextResponse.json(
      await flowstateStatus(
        publicClientFor(FLOWSTATE_CHAIN_ID),
        s.user.wallet as Address,
      ),
      { headers },
    );
  } catch (e) {
    return failure(e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success)
      return NextResponse.json(
        { message: "This voting request is invalid. Refresh and try again." },
        { status: 400, headers },
      );
    const client = publicClientFor(FLOWSTATE_CHAIN_ID);
    const wallet = s.user.wallet as Address;
    const db = await getDb();
    if (!(await getParticipant(db, s.user.id))) {
      if (!s.user.email)
        throw new FlowstateError(
          "Save your email in hackathon registration first, then return here.",
        );
      await saveParticipant(db, s.user, { email: s.user.email });
    }
    if (body.data.action === "prepare")
      return NextResponse.json(
        await prepareFlowstateVote(
          client,
          wallet,
          BigInt(body.data.additional),
        ),
        { headers },
      );
    if (body.data.action === "eligibility") {
      const status = await flowstateStatus(client, wallet);
      if (!status.verified)
        throw new FlowstateError(
          "Verify with GoodDollar before enabling voting.",
          403,
        );
      if (status.registered) return NextResponse.json(status, { headers });
      if (!(await getParticipant(db, s.user.id))) {
        if (!s.user.email)
          throw new FlowstateError(
            "Save your email in hackathon registration first, then return here.",
          );
        await saveParticipant(db, s.user, { email: s.user.email });
      }
      const now = new Date();
      const claimed = await db
        .update(hackathonParticipants)
        .set({ flowstateClaimAt: now })
        .where(
          and(
            eq(hackathonParticipants.userId, s.user.id),
            eq(hackathonParticipants.hackathon, HACKATHON_ID),
            or(
              isNull(hackathonParticipants.flowstateClaimAt),
              lt(
                hackathonParticipants.flowstateClaimAt,
                new Date(now.getTime() - 90_000),
              ),
            ),
          ),
        )
        .returning({ id: hackathonParticipants.id });
      if (!claimed.length)
        throw new FlowstateError(
          "Please wait 90 seconds before enabling voting again.",
          429,
        );
      await claimFlowstateEligibility(wallet, {
        signature: body.data.signature as Hex,
        issuedAt: body.data.issuedAt,
      });
      return NextResponse.json(await flowstateStatus(client, wallet), {
        headers,
      });
    }
    const confirmed =
      body.data.action === "existing"
        ? await confirmExistingFlowstateSupport(client, wallet)
        : await confirmFlowstateVote(client, wallet, body.data.hash as Hex);
    if (!confirmed.verified || BigInt(confirmed.support) <= BigInt(0))
      throw new FlowstateError(
        "This wallet does not currently have verified support for GoodBuildIt.",
      );
    const recorded = await db
      .update(hackathonParticipants)
      .set({
        flowstate: "voted",
        ...(confirmed.hash ? { flowstateTxHash: confirmed.hash } : {}),
        flowstateVotedAt: new Date(),
      })
      .where(
        and(
          eq(hackathonParticipants.userId, s.user.id),
          eq(hackathonParticipants.hackathon, HACKATHON_ID),
        ),
      )
      .returning({ id: hackathonParticipants.id });
    if (!recorded.length)
      throw new FlowstateError(
        "Your vote is on-chain, but we couldn’t save its confirmation. Please retry the confirmation.",
        503,
      );
    return NextResponse.json(confirmed, { headers });
  } catch (e) {
    return failure(e);
  }
}
