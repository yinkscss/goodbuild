/** Shared by claim.ts and referrals.ts, which would otherwise import each other. */
import { closeOf, HACKATHON_EVENTS } from "@/lib/hackathon-events";

/** The main hackathon (D99). Credits, referrals and the admin claim report all live under it. */
export const HACKATHON_ID = HACKATHON_EVENTS.main.id;

/**
 * The main hackathon's close (DRAFT date, matches content.ts). Claims stop here for main-only builders;
 * a campus member can claim until their campus closes (D166, `claimCloseFor`).
 */
export const CLAIMS_CLOSE = closeOf("main");
