import { NextResponse } from "next/server";

import { isProduction } from "@/server/auth/config";
import { requireSession } from "@/server/auth/http";
import { githubConfig } from "@/server/github/api";
import { GITHUB_STATE_COOKIE, newState, safeReturnTo } from "@/server/github/oauth";

/**
 * Start connecting GitHub. `public_repo` is the narrowest scope that can create a public repository and
 * push to it (D96). The person comes back through /api/github/callback.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.redirect(new URL("/", request.url));
  }
  const config = githubConfig();
  if (!config) return NextResponse.redirect(new URL(`${returnTo}${returnTo.includes("?") ? "&" : "?"}github=unavailable`, request.url));
  const { state, cookie } = await newState(session.user.id, returnTo);
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("scope", "public_repo");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("allow_signup", "true");
  const res = NextResponse.redirect(authorize);
  // Lax, not Strict: the callback is a cross-site navigation from github.com and must carry this cookie.
  res.cookies.set(GITHUB_STATE_COOKIE, cookie, { httpOnly: true, secure: isProduction(), sameSite: "lax", path: "/api/github", maxAge: 600 });
  return res;
}
