import { cleanReferralCode } from "@/lib/hackathon-referral";

/** Invites from the home dashboard (D153). Client-safe: the code format and the link shape. */
export { MAX_PAID_REFERRALS, REFERRAL_ALPHABET, REFERRAL_BONUS_CREDITS, cleanReferralCode } from "@/lib/hackathon-referral";

export const invitePath = (code: string) => `/r/${code}`;

/** The code in an invite path like `/r/ABCD2345`, or null. */
export function codeFromInvitePath(path: string): string | null {
  const m = /^\/r\/([^/?#]+)\/?$/.exec(path);
  return m ? cleanReferralCode(m[1]) : null;
}
