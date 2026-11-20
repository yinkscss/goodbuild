/** Shared by claim.ts and referrals.ts, which would otherwise import each other. */
import { HACKATHON_EVENTS } from "@/lib/hackathon-events";

/** The main hackathon (D99). Credits, referrals and the admin claim report all live under it. */
export const HACKATHON_ID = HACKATHON_EVENTS.main.id;

/** Claims stop when submissions close (DRAFT date, matches content.ts). */
export const CLAIMS_CLOSE = new Date("2026-12-10T23:00:00Z");
