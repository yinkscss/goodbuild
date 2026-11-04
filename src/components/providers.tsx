"use client";

import * as React from "react";

import { PrivyAuthProvider } from "@/lib/auth/privy/privy-auth";
import { SessionOnlyAuthProvider } from "@/lib/auth/session-only";

/**
 * App-wide client providers. With NEXT_PUBLIC_PRIVY_APP_ID unset the app still runs:
 * prompts can be typed and saved, existing sessions are recognised, and the connect
 * modal explains that new sign-ins are off.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <SessionOnlyAuthProvider>{children}</SessionOnlyAuthProvider>;
  return <PrivyAuthProvider appId={appId}>{children}</PrivyAuthProvider>;
}
