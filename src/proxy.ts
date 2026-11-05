import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE } from "@/lib/auth/cookie-names";
import { classifyHost, publishedAppsDomain } from "@/lib/published-host";
import { EDGE_HEADER, EDGE_HOST_HEADER, isFromEdge } from "@/server/edge";
import { isBlockedRegion } from "@/server/geo";

const UNAVAILABLE = "<!doctype html><title>Not available</title><p>This app isn't available in your region.</p>";

/**
 * A write to the API from another site or subdomain. Published apps are same-site with the main
 * site, so the browser sends the session cookie with their requests whatever SameSite and __Host-
 * say, and a text/plain POST skips the CORS preflight. Requests with neither header aren't from a
 * browser page (scripts, webhooks) and carry no ambient cookie to abuse.
 */
function isForeignWrite(request: NextRequest): boolean {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return false;
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "same-site" || fetchSite === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  try {
    return new URL(origin).host !== request.headers.get("host");
  } catch {
    return true; // Origin: null, from a sandboxed frame
  }
}

/** On the edge, send this request on to the backend, which does the heavy work (D26). */
function toBackend(request: NextRequest, backend: string, path: string) {
  const headers = new Headers(request.headers);
  headers.set(EDGE_HEADER, process.env.EDGE_SECRET ?? "");
  headers.set(EDGE_HOST_HEADER, request.headers.get("host") ?? "");
  return NextResponse.rewrite(new URL(`${path}${request.nextUrl.search}`, backend), { request: { headers } });
}

/**
 * - Backend behind an edge (EDGE_SECRET, no BACKEND_ORIGIN): only the edge may call it. The edge has
 *   already applied every rule below, and a direct caller would skip the region gate.
 * - Published app hosts: serve that app's files and nothing else, so generated code can't reach the
 *   API or any page of the main site. Blocked regions get a 451, because these pages transact (D10).
 * - The route that serves those files doesn't exist on the main host.
 * - API: region gate (D10). Sign-in, building and credits return 451 from blocked regions.
 * - App pages (/home, /p/*): without a session cookie, go to the landing page before
 *   rendering anything. The page itself still verifies the session properly.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const backend = process.env.BACKEND_ORIGIN;

  if (process.env.EDGE_SECRET && !backend) {
    return isFromEdge(request.headers) ? NextResponse.next() : new NextResponse("Not found", { status: 404 });
  }

  const host = classifyHost(request.headers.get("host"), publishedAppsDomain());
  if (host.kind === "unknown") return new NextResponse("Not found", { status: 404 });
  if (host.kind === "app") {
    if (isBlockedRegion(request.headers)) {
      return new NextResponse(UNAVAILABLE, { status: 451, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    const appPath = `/published-app/${host.slug}${pathname === "/" ? "" : pathname}`;
    return backend ? toBackend(request, backend, appPath) : NextResponse.rewrite(new URL(appPath, request.url));
  }

  if (pathname.startsWith("/published-app")) return new NextResponse("Not found", { status: 404 });
  if (pathname.startsWith("/api/")) {
    if (isForeignWrite(request)) return NextResponse.json({ error: "forbidden_origin" }, { status: 403 });
    if (isBlockedRegion(request.headers)) {
      return NextResponse.json(
        { error: "region_blocked", message: "GoodBuild isn't available in your region." },
        { status: 451 },
      );
    }
    return backend ? toBackend(request, backend, pathname) : NextResponse.next();
  }
  if (backend && pathname.startsWith("/a/")) return toBackend(request, backend, pathname);
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
