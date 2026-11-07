"use client";

import * as React from "react";

import { useAuth } from "@/lib/auth/context";

/**
 * Whether the server's mainnet switch (D50) lets this viewer start a new mainnet deploy right now.
 * It asks the server, because the switch changes while the app runs and isn't baked into the build.
 * False until the answer arrives, and false if the request fails. It is for what the screen offers:
 * the server checks again on every prepare.
 */
export function useMainnetAllowed(): boolean {
  const userId = useAuth().user?.id ?? null;
  const [allowed, setAllowed] = React.useState(false);
  React.useEffect(() => {
    let live = true;
    fetch("/api/mainnet", { cache: "no-store", credentials: "same-origin" })
      .then((res) => (res.ok ? (res.json() as Promise<{ allowed?: boolean }>) : { allowed: false }))
      .then((data) => live && setAllowed(data.allowed === true))
      .catch(() => live && setAllowed(false));
    return () => {
      live = false;
    };
  }, [userId]);
  return allowed;
}
