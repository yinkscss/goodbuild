"use client";

import * as React from "react";

import { AuthContextProvider, unconfiguredAuth } from "./context";
import { endSession, fetchSession } from "./session-client";
import type { AuthApi, SessionUser } from "./types";

/**
 * Auth when no wallet provider is configured (no Privy app id). New sign-ins are off,
 * but an existing GoodBuild session (ours, not Privy's) is still recognised and can be
 * signed out. Also what the app uses in development before Privy is set up.
 */
export function SessionOnlyAuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<SessionUser | null>(null);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    fetchSession()
      .then((u) => alive && setUser(u))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const value = React.useMemo<AuthApi>(
    () => ({
      ...unconfiguredAuth,
      ready,
      user,
      async signOut() {
        await endSession();
        setUser(null);
      },
    }),
    [ready, user],
  );
  return <AuthContextProvider value={value}>{children}</AuthContextProvider>;
}
