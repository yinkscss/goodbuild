import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Address } from "viem";
import type { Db } from "@/server/db/client";
import {
  flowstateVoters,
  hackathonApprovals,
  hackathonEntries,
  hackathonParticipants,
  hackathonRegistrations,
} from "@/server/db/hackathon-schema";
import { users } from "@/server/db/schema";
import { allocateHackathonRewards } from "@/lib/hackathon-rewards";
import { CLAIMS_CLOSE, HACKATHON_ID } from "./claim";

const link = z.union([
  z.literal(""),
  z
    .url()
    .max(2000)
    .refine((v) => {
      const u = new URL(v);
      return u.protocol === "https:" && !u.username && !u.password;
    }, "Use an https:// link without login details."),
]);
export const entryInput = z.object({
  alias: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(100),
  pitch: z.string().trim().min(1).max(160),
  liveUrl: link,
  sourceUrl: link,
});
export const participantInput = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.trim().toLowerCase()),
  flowstate: z.enum(["pending", "visited", "skipped"]).optional(),
});
type Actor = { id: string; wallet: string };
export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export async function saveParticipant(
  db: Db,
  user: Actor,
  input: z.input<typeof participantInput>,
) {
  const data = participantInput.parse(input);
  // Anyone signed in can vote before signing up (D126). A vote already confirmed on-chain carries over,
  // so the signup, the submit gate (D131) and the CSV all see it.
  const [vote] = await db
    .select({ txHash: flowstateVoters.txHash, votedAt: flowstateVoters.votedAt })
    .from(flowstateVoters)
    .where(eq(flowstateVoters.userId, user.id));
  const voted = vote?.votedAt
    ? { flowstate: "voted" as const, flowstateTxHash: vote.txHash, flowstateVotedAt: vote.votedAt }
    : null;
  const [row] = await db
    .insert(hackathonParticipants)
    .values({ hackathon: HACKATHON_ID, userId: user.id, ...data, ...voted })
    .onConflictDoUpdate({
      target: [hackathonParticipants.hackathon, hackathonParticipants.userId],
      // The first email saved is kept: the signup form shows it locked, and a later request can't swap it.
      set: {
        email: sql`${hackathonParticipants.email}`,
        ...(voted
          ? voted
          : data.flowstate
            ? {
                flowstate: sql`case when ${hackathonParticipants.flowstate} = 'voted' then 'voted' else ${data.flowstate} end`,
              }
            : {}),
      },
    })
    .returning();
  return row;
}
export async function getParticipant(db: Db, userId: string) {
  const [row] = await db
    .select()
    .from(hackathonParticipants)
    .where(
      and(
        eq(hackathonParticipants.hackathon, HACKATHON_ID),
        eq(hackathonParticipants.userId, userId),
      ),
    );
  return row ?? null;
}
export async function saveEntry(
  db: Db,
  user: Actor,
  input: z.input<typeof entryInput>,
) {
  if (new Date() >= CLAIMS_CLOSE)
    throw new CommunityError("Submissions are closed.", 410);
  const data = entryInput.parse(input);
  const participant = await getParticipant(db, user.id);
  if (!participant)
    throw new CommunityError(
      "Save your signup email before submitting a project.",
    );
  // Registration needs verify and vote (D131). "voted" is only ever set by the on-chain vote check,
  // which also requires a verified wallet, so it covers both.
  if (participant.flowstate !== "voted")
    throw new CommunityError(
      "Verify with GoodDollar and vote first, then submit your project.",
      403,
    );
  const [entry] = await db
    .insert(hackathonEntries)
    .values({ hackathon: HACKATHON_ID, userId: user.id, ...data })
    .onConflictDoUpdate({
      target: [hackathonEntries.hackathon, hackathonEntries.userId],
      set: data,
    })
    .returning();
  return entry;
}
export async function ownEntry(db: Db, userId: string) {
  const [entry] = await db
    .select()
    .from(hackathonEntries)
    .where(
      and(
        eq(hackathonEntries.hackathon, HACKATHON_ID),
        eq(hackathonEntries.userId, userId),
      ),
    );
  return entry ?? null;
}
export async function listEntries(db: Db) {
  return db
    .select({
      id: hackathonEntries.id,
      alias: hackathonEntries.alias,
      title: hackathonEntries.title,
      pitch: hackathonEntries.pitch,
      liveUrl: hackathonEntries.liveUrl,
      sourceUrl: hackathonEntries.sourceUrl,
      approvals: sql<number>`count(${hackathonApprovals.id})::int`,
    })
    .from(hackathonEntries)
    .leftJoin(
      hackathonApprovals,
      eq(hackathonApprovals.entryId, hackathonEntries.id),
    )
    .where(eq(hackathonEntries.hackathon, HACKATHON_ID))
    .groupBy(hackathonEntries.id)
    .orderBy(
      desc(sql`count(${hackathonApprovals.id})`),
      asc(hackathonEntries.createdAt),
      asc(hackathonEntries.id),
    );
}
export async function approveEntry(
  db: Db,
  user: Actor,
  entryId: string,
  readRoot: (wallet: Address) => Promise<Address | null>,
  now = new Date(),
) {
  if (now >= CLAIMS_CLOSE)
    throw new CommunityError("Approvals are closed.", 410);
  const root = await readRoot(user.wallet as Address);
  if (!root)
    throw new CommunityError(
      "Please verify your wallet with GoodDollar before approving.",
      403,
    );
  const [entry] = await db
    .select({ entry: hackathonEntries, ownerWallet: users.wallet })
    .from(hackathonEntries)
    .innerJoin(users, eq(users.id, hackathonEntries.userId))
    .where(
      and(
        eq(hackathonEntries.id, entryId),
        eq(hackathonEntries.hackathon, HACKATHON_ID),
      ),
    );
  if (!entry) throw new CommunityError("Project not found.", 404);
  if (
    entry.entry.userId === user.id ||
    (await readRoot(entry.ownerWallet as Address))?.toLowerCase() ===
      root.toLowerCase()
  )
    throw new CommunityError("You cannot approve your own project.", 403);
  if (!entry.entry.liveUrl)
    throw new CommunityError(
      "This builder needs to publish a live app before receiving approvals.",
    );
  await db
    .insert(hackathonApprovals)
    .values({ entryId, goodidRoot: root.toLowerCase() })
    .onConflictDoNothing();
  return { approved: true };
}
function csvCell(value: unknown) {
  const s = String(value ?? "");
  return `"${(/^[\s]*[=+@\-\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""')}"`;
}
export async function participantCsv(db: Db) {
  const rewards = new Map(
    allocateHackathonRewards(await listEntries(db)).map((entry) => [
      entry.id,
      entry,
    ]),
  );
  const rows = await db
    .select({
      participant: hackathonParticipants,
      wallet: users.wallet,
      verifiedAt: users.verifiedAt,
      walletKind: users.walletKind,
      loginEmail: users.email,
      approvals: sql<number>`(select count(*)::int from ${hackathonApprovals} where ${hackathonApprovals.entryId} = ${hackathonEntries.id})`,
      entry: hackathonEntries,
      registration: hackathonRegistrations,
    })
    .from(hackathonParticipants)
    .innerJoin(users, eq(users.id, hackathonParticipants.userId))
    .leftJoin(
      hackathonEntries,
      and(
        eq(hackathonEntries.userId, users.id),
        eq(hackathonEntries.hackathon, HACKATHON_ID),
      ),
    )
    .leftJoin(
      hackathonRegistrations,
      and(
        eq(hackathonRegistrations.userId, users.id),
        eq(hackathonRegistrations.hackathon, HACKATHON_ID),
      ),
    )
    .where(eq(hackathonParticipants.hackathon, HACKATHON_ID))
    .orderBy(asc(hackathonParticipants.createdAt));
  return [
    [
      "email",
      "wallet",
      "wallet_kind",
      "email_source",
      "signed_up_at",
      "verified_at",
      "flowstate_action",
      "flowstate_vote_tx",
      "flowstate_confirmed_at",
      "alias",
      "project",
      "pitch",
      "live_url",
      "source_url",
      "approvals",
      "estimated_base_gd",
      "estimated_topup_gd",
      "estimated_total_gd",
      "start_microcredits",
      "deploy_microcredits",
    ],
    ...rows.map((r) => [
      r.participant.email,
      r.wallet,
      r.walletKind,
      r.loginEmail === r.participant.email ? "email_login" : "contact_only",
      r.participant.createdAt.toISOString(),
      r.verifiedAt?.toISOString(),
      r.participant.flowstate,
      r.participant.flowstateTxHash,
      r.participant.flowstateVotedAt?.toISOString(),
      r.entry?.alias,
      r.entry?.title,
      r.entry?.pitch,
      r.entry?.liveUrl,
      r.entry?.sourceUrl,
      r.approvals,
      r.entry ? (rewards.get(r.entry.id)?.baseGd ?? 0) : 0,
      r.entry ? (rewards.get(r.entry.id)?.topupGd ?? 0) : 0,
      r.entry ? (rewards.get(r.entry.id)?.totalGd ?? 0) : 0,
      r.registration?.startMicro ?? 0,
      r.registration?.deployMicro ?? 0,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
