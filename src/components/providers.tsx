"use client";

import * as React from "react";

import { MagicAuthProvider } from "@/lib/auth/magic/magic-auth";
import { SessionOnlyAuthProvider } from "@/lib/auth/session-only";

/**
 * App-wide client providers. With NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY unset the app still runs:
 * prompts can be typed and saved, existing sessions are recognised, and the connect
 * modal explains that new sign-ins are off.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const key = process.env.NEXT_PUBLIC_MAGIC_PUBLISHABLE_KEY;
  if (!key) return <SessionOnlyAuthProvider>{children}</SessionOnlyAuthProvider>;
  return <MagicAuthProvider publishableKey={key}>{children}</MagicAuthProvider>;
}
