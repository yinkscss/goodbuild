import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { githubAccounts } from "@/server/db/github-schema";
import { githubConfig, revokeToken } from "@/server/github/api";
import { decryptToken } from "@/server/github/crypto";

const headers = { "Cache-Control": "no-store, private" };

/** Whether GitHub is set up on this server, and which account the person connected. Never the token. */
export async function GET() {
  try {
    const session = await requireSession();
    const [account] = await (await getDb()).select({ login: githubAccounts.login }).from(githubAccounts).where(eq(githubAccounts.userId, session.user.id)).limit(1);
    return NextResponse.json({ configured: githubConfig() !== null, connected: !!account, login: account?.login ?? null }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/** Disconnect: forget the token and tell GitHub. Repositories already created stay on GitHub; syncing stops. */
export async function DELETE() {
  try {
    const session = await requireSession();
    const db = await getDb();
    const [account] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, session.user.id)).limit(1);
    if (account) {
      const token = decryptToken(account.tokenEnc);
      await db.delete(githubAccounts).where(eq(githubAccounts.userId, session.user.id));
      if (token) await revokeToken(token);
    }
    return NextResponse.json({ connected: false }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
