import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { isProduction } from "@/server/auth/config";
import { requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { githubAccounts } from "@/server/db/github-schema";
import { exchangeCode, getViewer, revokeToken } from "@/server/github/api";
import { decryptToken, encryptToken } from "@/server/github/crypto";
import { GITHUB_STATE_COOKIE, checkState } from "@/server/github/oauth";
import { linksOwnedByOthers } from "@/server/github/sync";
import { eq } from "drizzle-orm";

function back(request: Request, returnTo: string, result: "connected" | "failed" | "different_account") {
  const target = new URL(returnTo, request.url);
  target.searchParams.set("github", result);
  const res = NextResponse.redirect(target);
  res.cookies.set(GITHUB_STATE_COOKIE, "", { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/api/github", maxAge: 0 });
  return res;
}

/** GitHub sends the person back here with a one-time code. Trade it for a token and keep it encrypted. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const checked = await checkState((await cookies()).get(GITHUB_STATE_COOKIE)?.value, url.searchParams.get("state"), session.user.id);
  if (!checked) return back(request, "/settings?tab=github", "failed");
  const code = url.searchParams.get("code");
  if (!code || url.searchParams.get("error")) return back(request, checked.returnTo, "failed");
  try {
    const { token, scope } = await exchangeCode(code);
    const viewer = await getViewer(token);
    const db = await getDb();
    // Apps already synced to another GitHub account would stop syncing under this one. Refuse, and say why in Settings.
    if ((await linksOwnedByOthers(db, session.user.id, viewer.login)).length) {
      await revokeToken(token);
      return back(request, "/settings?tab=github", "different_account");
    }
    const [previous] = await db.select().from(githubAccounts).where(eq(githubAccounts.userId, session.user.id)).limit(1);
    const values = { githubId: String(viewer.id), login: viewer.login, tokenEnc: encryptToken(token), scope };
    await db
      .insert(githubAccounts)
      .values({ userId: session.user.id, ...values })
      .onConflictDoUpdate({ target: githubAccounts.userId, set: { ...values, createdAt: new Date() } });
    // GitHub keeps every token it has issued to this person for GoodBuild, so retire the one being replaced.
    const old = previous ? decryptToken(previous.tokenEnc) : null;
    if (old && old !== token && !(await revokeToken(old))) console.error("github: couldn't revoke a replaced token");
    return back(request, checked.returnTo, "connected");
  } catch (error) {
    console.error("github connect failed", error instanceof Error ? error.message : error);
    return back(request, checked.returnTo, "failed");
  }
}
