import { NextResponse, type NextRequest } from "next/server";

import { isBlockedRegion } from "@/server/geo";

const SESSION_COOKIE = "gb_session";

/**
 * - API: region gate (D10). Sign-in, building and credits return 451 from blocked regions.
 * - App pages (/home, /p/*): without a session cookie, go to the landing page before
 *   rendering anything. The page itself still verifies the session properly.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    if (isBlockedRegion(request.headers)) {
      return NextResponse.json(
        { error: "region_blocked", message: "GoodBuild isn't available in your region." },
        { status: 451 },
      );
    }
    return NextResponse.next();
  }
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/home", "/p/:path*"],
};
