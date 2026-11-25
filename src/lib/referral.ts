import { cleanReferralCode } from "@/lib/hackathon-referral";

/** Invites from the home dashboard (D155). Client-safe: the code format and the link shape. */
export { MAX_PAID_REFERRALS, REFERRAL_ALPHABET, REFERRAL_BONUS_CREDITS, cleanReferralCode } from "@/lib/hackathon-referral";

export const invitePath = (code: string) => `/r/${code}`;

/** The code in an invite path like `/r/ABCD2345`, or null. */
export function codeFromInvitePath(path: string): string | null {
  const m = /^\/r\/([^/?#]+)\/?$/.exec(path);
  return m ? cleanReferralCode(m[1]) : null;
}

export interface FriendProgress {
  verified: boolean;
  voted: boolean;
  rewarded: boolean;
}

/** One plain word for where a friend is, and which step they have left. */
export function friendStatus(f: FriendProgress): { label: string; tone: "ok" | "wait" | "new"; detail: string } {
  if (f.rewarded) return { label: "Rewarded", tone: "ok", detail: "You both got your credits" };
  if (f.verified && f.voted) return { label: "Almost there", tone: "wait", detail: "Credits are on the way" };
  if (f.verified) return { label: "1 step left", tone: "wait", detail: "Verified, waiting for their vote" };
  return { label: "Needs verifying", tone: "new", detail: "Joined, not verified yet" };
}
