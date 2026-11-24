/** Shared by claim.ts and referrals.ts, which would otherwise import each other. */
import { HACKATHON, HACKATHON_CLOSE } from "@/lib/hackathon-events";

/** The hackathon (D99, one since D170). Credits, referrals and the admin claim report all live under it. */
export const HACKATHON_ID = HACKATHON.id;

/** The hackathon's close (31 Dec 2026, D170). Entries, approvals, claims and referral payouts stop here. */
export const CLAIMS_CLOSE = HACKATHON_CLOSE;
