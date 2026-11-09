import { NextResponse } from "next/server";

import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { listUserDeployments } from "@/server/deploy/list";

/** The signed-in user's deployed contracts across all their projects, newest first. Never another user's rows. */
export async function GET() {
  try {
    const session = await requireSession();
    const deployments = await listUserDeployments(await getDb(), session.user.id);
    return NextResponse.json({ deployments }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
