"use client";
import * as React from "react";
import { REFERRAL_STORAGE_KEY, cleanReferralCode } from "@/lib/hackathon-referral";

/** Remember an invite code from ?ref= so it survives sign-up and the GoodDollar trip. Renders nothing. */
export function ReferralCapture() {
  React.useEffect(() => {
    try {
      const code = cleanReferralCode(new URLSearchParams(window.location.search).get("ref"));
      if (code) window.localStorage.setItem(REFERRAL_STORAGE_KEY, code);
    } catch {
      // Storage blocked: the invite just isn't remembered.
    }
  }, []);
  return null;
}

export function storedReferral(): string | undefined {
  try {
    return cleanReferralCode(window.localStorage.getItem(REFERRAL_STORAGE_KEY)) ?? undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredReferral() {
  try {
    window.localStorage.removeItem(REFERRAL_STORAGE_KEY);
  } catch {
    // Nothing to clear.
  }
}
