import { NextResponse, type NextRequest } from "next/server";

import { isBlockedRegion } from "@/server/geo";

/**
 * Region gate for the API (D10). Pages stay viewable everywhere; sign-in, building
 * and credits are refused from blocked regions with 451.
 */
export function proxy(request: NextRequest) {
  if (isBlockedRegion(request.headers)) {
    return NextResponse.json(
      { error: "region_blocked", message: "GoodBuild isn't available in your region." },
      { status: 451 },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
