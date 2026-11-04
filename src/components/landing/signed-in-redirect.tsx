"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/context";
import { readPendingPrompt } from "@/lib/pending-prompt";

/**
 * Signed-in visitors to the landing page go to /home, unless a saved prompt is about
 * to be sent (the send gate routes those straight to the new project instead).
 */
export function SignedInRedirect() {
  const { ready, user } = useAuth();
  const router = useRouter();
  React.useEffect(() => {
    if (ready && user && !readPendingPrompt()) router.replace("/home");
  }, [ready, user, router]);
  return null;
}
