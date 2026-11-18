/** Referral credits (D136). Client-safe constants and the code format. */
export const REFERRAL_BONUS_CREDITS = 10;
/** How many invited builders can earn one inviter the bonus. The invited builder is always paid. */
export const MAX_PAID_REFERRALS = 3;
/** Its own pot, so referrals can't use up the 20 start credits promised to new builders. */
export const DEFAULT_REFERRAL_BUDGET_CREDITS = 1_000;
export const REFERRAL_STORAGE_KEY = "gb:hk-ref";

/** No 0, O, 1, I or L, so a code read aloud or from a screenshot is hard to get wrong. */
export const REFERRAL_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** A well-formed code, uppercased, or null for anything else. Never throws. */
export function cleanReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6,12}$/.test(code) ? code : null;
}
