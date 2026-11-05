import { NextResponse, type NextRequest } from "next/server";

import { DATA_PATH_PREFIX, DATA_ROUTE_PREFIX } from "@/lib/app-data";
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
 *   The one exception is the app's data API at /__gb/data/, after the same region check (docs/APP_DATA.md).
 * - The routes that serve those files and that data don't exist on the main host.
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

  // Sign-in only accepts APP_DOMAIN (SIWE), so www has to land on it.
  if (process.env.APP_DOMAIN && request.headers.get("host") === `www.${process.env.APP_DOMAIN}`) {
    return NextResponse.redirect(`https://${process.env.APP_DOMAIN}${pathname}${request.nextUrl.search}`, 308);
  }

  const host = classifyHost(request.headers.get("host"), publishedAppsDomain());
  if (host.kind === "unknown") return new NextResponse("Not found", { status: 404 });
  if (host.kind === "app") {
    const isData = pathname.startsWith(DATA_PATH_PREFIX);
    if (isBlockedRegion(request.headers)) {
      if (isData) return NextResponse.json({ error: "region_blocked", message: "This app isn't available in your region." }, { status: 451 });
      return new NextResponse(UNAVAILABLE, { status: 451, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }
    if (isData) {
      // The data API is the one thing on an app host that isn't its files. Encoded paths are refused, so nothing can climb out of it.
      const rest = pathname.slice(DATA_PATH_PREFIX.length);
      if (!/^[A-Za-z0-9_.:/-]*$/.test(rest)) return NextResponse.json({ error: "not_found", message: "There's nothing here." }, { status: 404 });
      const dataPath = `${DATA_ROUTE_PREFIX}/${host.slug}/${rest}`;
      return backend ? toBackend(request, backend, dataPath) : NextResponse.rewrite(new URL(`${dataPath}${request.nextUrl.search}`, request.url));
    }
    const appPath = `/published-app/${host.slug}${pathname === "/" ? "" : pathname}`;
    return backend ? toBackend(request, backend, appPath) : NextResponse.rewrite(new URL(appPath, request.url));
  }

  if (pathname.startsWith("/published-app") || pathname.startsWith(DATA_ROUTE_PREFIX)) return new NextResponse("Not found", { status: 404 });
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
