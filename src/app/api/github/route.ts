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
    const [account] = await (await getDb()).select().from(githubAccounts).where(eq(githubAccounts.userId, session.user.id)).limit(1);
    // A saved token that can't be read (SESSION_SECRET changed) is no connection: the person has to connect again.
    const readable = !!account && decryptToken(account.tokenEnc) !== null;
    return NextResponse.json({ configured: githubConfig() !== null, connected: readable, reconnect: !!account && !readable, login: readable ? account.login : null }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * Disconnect: forget the token and ask GitHub to revoke it. Repositories already created stay on GitHub; syncing
 * stops. `revoked` is false when GitHub didn't confirm, so the person can remove GoodBuild there themselves.
 */
export async function DELETE() {
  try {
    const session = await requireSession();
    const db = await getDb();
    const [account] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, session.user.id)).limit(1);
    let revoked = true;
    if (account) {
      const token = decryptToken(account.tokenEnc);
      await db.delete(githubAccounts).where(eq(githubAccounts.userId, session.user.id));
      revoked = token ? await revokeToken(token) : false;
    }
    return NextResponse.json({ connected: false, revoked }, { headers });
  } catch (error) {
    return errorResponse(error);
  }
}
