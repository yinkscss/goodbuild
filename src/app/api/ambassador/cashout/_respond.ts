import { NextResponse } from "next/server";
import { errorResponse } from "@/server/auth/http";
import { AmbassadorError } from "@/server/ambassador/service";
import { GoodCashError } from "@/server/goodcash/client";

export const headers = { "Cache-Control": "private, no-store" };

/** Plain-words errors for the person; anything unexpected goes through the app's usual handler. */
export function fail(e: unknown) {
  if (e instanceof AmbassadorError) return NextResponse.json({ message: e.message }, { status: 409, headers });
  if (e instanceof GoodCashError) return NextResponse.json({ message: e.message, code: e.gcCode }, { status: e.status, headers });
  return errorResponse(e);
}
