"use client";

import * as React from "react";

import { AuthContextProvider, unconfiguredAuth } from "@/lib/auth/context";
import { PrivyAuthProvider } from "@/lib/auth/privy/privy-auth";

/**
 * App-wide client providers. With NEXT_PUBLIC_PRIVY_APP_ID unset the app still runs:
 * prompts can be typed and saved, and the connect modal explains sign-in is off.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) return <AuthContextProvider value={unconfiguredAuth}>{children}</AuthContextProvider>;
  return <PrivyAuthProvider appId={appId}>{children}</PrivyAuthProvider>;
}
