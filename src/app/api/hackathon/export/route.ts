import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { participantCsv } from "@/server/hackathon/community";
import { isAdminWallet } from "@/server/settings/mainnet-access";
export async function GET() {
  try {
    const s = await requireSession();
    if (!isAdminWallet(s.user.wallet))
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    return new Response("\uFEFF" + (await participantCsv(await getDb())), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="goodbuild-hackathon-signups.csv"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
