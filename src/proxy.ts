import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/cookie-names";
import { classifyHost, publishedAppsDomain } from "@/lib/published-host";
import { isBlockedRegion } from "@/server/geo";

const UNAVAILABLE = "<!doctype html><title>Not available</title><p>This app isn't available in your region.</p>";

/**
 * - Published app hosts: serve that app's files and nothing else, so generated code can't reach the
 *   API or any page of the main site. Blocked regions get a 451, because these pages transact (D10).
 * - The route that serves those files doesn't exist on the main host.
 * - API: region gate (D10). Sign-in, building and credits return 451 from blocked regions.
 * - App pages (/home, /p/*): without a session cookie, go to the landing page before
 *   rendering anything. The page itself still verifies the session properly.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const host = classifyHost(request.headers.get("host"), publishedAppsDomain());
  if (host.kind === "unknown") return new NextResponse("Not found", { status: 404 });
  if (host.kind === "app") {
    if (isBlockedRegion(request.headers)) {
      return new NextResponse(UNAVAILABLE, { status: 451, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    return NextResponse.rewrite(new URL(`/published-app/${host.slug}${pathname}`, request.url));
  }

  if (pathname.startsWith("/published-app")) return new NextResponse("Not found", { status: 404 });
  if (pathname.startsWith("/api/")) {
    if (isBlockedRegion(request.headers)) {
      return NextResponse.json(
        { error: "region_blocked", message: "GoodBuild isn't available in your region." },
        { status: 451 },
      );
    }
    return NextResponse.next();
  }
  if (pathname === "/home" || pathname.startsWith("/p/")) {
    if (!request.cookies.has(SESSION_COOKIE)) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }
  return NextResponse.next();
}

// Every path, because any path on a published app's host must stay inside that app.
export const config = {
  matcher: ["/:path*"],
};
