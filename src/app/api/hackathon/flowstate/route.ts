import { NextResponse } from "next/server";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Address, Hex } from "viem";
import { AuthError } from "@/server/auth/errors";
import { requireSession, errorResponse } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { flowstateVoters, hackathonParticipants } from "@/server/db/hackathon-schema";
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
import { HACKATHON_ID } from "@/server/hackathon/claim";
import { ensureGas, GasGrantError } from "@/server/gas-grant/grant";
import { gasGrantDeps } from "@/server/gas-grant/runtime";
import { SUPPORT_TELEGRAM_URL } from "@/config/site-links";
import { FreeGrantError, claimWelcome, freePolicy } from "@/server/credits/free-grants";
import { readGoodIdentityOnCelo, syncGoodId } from "@/server/goodid";
import { hasUnsettledInvite, settleInviteOnVote } from "@/server/referrals/referrals";
import type { ResolvedSession } from "@/server/auth/service";
const headers = { "Cache-Control": "no-store" };
/**
 * FlowState reads verification straight from the chain, so someone verified with GoodDollar elsewhere
 * never passes through Verify. Record it the first time we see it, so they're counted (/stats).
 */
async function recordVerified(s: ResolvedSession, verified: boolean) {
  if (!verified || s.user.verifiedAt) return;
  await syncGoodId(await getDb(), s.user).catch((e) =>
    console.error("[flowstate] goodid record failed", e instanceof Error ? e.name : "unknown"),
  );
}
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
  if (e instanceof GasGrantError)
    return NextResponse.json(
      { message: e.message, telegram: e.telegram ? SUPPORT_TELEGRAM_URL : undefined },
      { status: e.code === "not_verified" ? 403 : 409, headers },
    );
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
    const status = await flowstateStatus(
      publicClientFor(FLOWSTATE_CHAIN_ID),
      s.user.wallet as Address,
    );
    await recordVerified(s, status.verified);
    return NextResponse.json(status, { headers });
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
    // Any signed-in wallet can vote (D126): no email or hackathon signup needed.
    await db.insert(flowstateVoters).values({ userId: s.user.id }).onConflictDoNothing();
    if (body.data.action === "prepare") {
      const additional = BigInt(body.data.additional);
      let review = await prepareFlowstateVote(client, wallet, additional);
      let gasGrant: { amountWei: string; txHash: string } | undefined;
      if (review.short) {
        // Only someone who can vote right now gets here: verified, registered, with points to give.
        const grant = await ensureGas(db, s.user, BigInt(review.feeCapWei), "hackathon_vote", gasGrantDeps());
        if (grant.kind === "granted") gasGrant = { amountWei: String(grant.amountWei), txHash: grant.txHash };
        review = await prepareFlowstateVote(client, wallet, additional);
        if (review.short)
          throw new FlowstateError(
            "Your wallet still needs a little CELO for the network fee. Please wait a minute and review your vote again. No votes or credits have been spent.",
          );
      }
      return NextResponse.json({ ...review, gasGrant }, { headers });
    }
    if (body.data.action === "eligibility") {
      const status = await flowstateStatus(client, wallet);
      await recordVerified(s, status.verified);
      if (!status.verified)
        throw new FlowstateError(
          "Verify with GoodDollar before enabling voting.",
          403,
        );
      if (status.registered) return NextResponse.json(status, { headers });
      const now = new Date();
      const claimed = await db
        .update(flowstateVoters)
        .set({ claimAt: now })
        .where(
          and(
            eq(flowstateVoters.userId, s.user.id),
            or(
              isNull(flowstateVoters.claimAt),
              lt(flowstateVoters.claimAt, new Date(now.getTime() - 90_000)),
            ),
          ),
        )
        .returning({ id: flowstateVoters.userId });
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
    await recordVerified(s, confirmed.verified);
    if (!confirmed.verified || BigInt(confirmed.support) <= BigInt(0))
      throw new FlowstateError(
        "This wallet does not currently have verified support for GoodBuildIt.",
      );
    const votedAt = new Date();
    const recorded = await db
      .update(flowstateVoters)
      .set({
        ...(confirmed.hash ? { txHash: confirmed.hash } : {}),
        votedAt,
      })
      .where(eq(flowstateVoters.userId, s.user.id))
      .returning({ id: flowstateVoters.userId });
    // Hackathon signups keep their own copy, for the CSV and the hackathon credit claim.
    await db
      .update(hackathonParticipants)
      .set({
        flowstate: "voted",
        ...(confirmed.hash ? { flowstateTxHash: confirmed.hash } : {}),
        flowstateVotedAt: votedAt,
      })
      .where(
        and(
          eq(hackathonParticipants.userId, s.user.id),
          eq(hackathonParticipants.hackathon, HACKATHON_ID),
        ),
      );
    if (!recorded.length)
      throw new FlowstateError(
        "Your vote is on-chain, but we couldn’t save its confirmation. Please retry the confirmation.",
        503,
      );
    // The vote was just confirmed on-chain, so the welcome credits it unlocks (D125) are posted here too:
    // whoever votes, wherever (the hackathon page, the dashboard, the credits card), gets them at once.
    let welcomeMicro = 0;
    if (freePolicy(process.env) === "verified") {
      try {
        welcomeMicro = (await claimWelcome(db, s.user, { readIdentity: readGoodIdentityOnCelo, readVoted: async () => true })).grantedMicro;
      } catch (e) {
        // Never fails the vote: the credits card retries the welcome and says why.
        if (!(e instanceof FreeGrantError)) console.error("[flowstate] welcome after vote failed", e instanceof Error ? e.name : "unknown");
      }
    }
    // An invited person's vote also pays the invite bonus (D153): to them, and to whoever invited them.
    let inviteMicro = 0;
    try {
      if (await hasUnsettledInvite(db, s.user.id)) {
        const identity = await readGoodIdentityOnCelo(wallet);
        if (identity.root) inviteMicro = (await settleInviteOnVote(db, { userId: s.user.id, root: identity.root, env: process.env })).paidMicro;
      }
    } catch (e) {
      // Never fails the vote: the next confirmation tries again.
      console.error("[flowstate] invite bonus after vote failed", e instanceof Error ? e.name : "unknown");
    }
    return NextResponse.json({ ...confirmed, welcomeMicro, inviteMicro }, { headers });
  } catch (e) {
    return failure(e);
  }
}
