import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { participantCsv } from "@/server/hackathon/community";
import { isAdminWallet } from "@/server/settings/mainnet-access";
import { parseEvent } from "@/lib/hackathon-events";
/** `?event=futminna` exports the FUTMinna signups (D160). */
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    if (!isAdminWallet(s.user.wallet))
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const event = parseEvent(new URL(request.url).searchParams.get("event"));
    return new Response("\uFEFF" + (await participantCsv(await getDb(), event)), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          `attachment; filename="goodbuild-${event === "main" ? "hackathon" : event}-signups.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
