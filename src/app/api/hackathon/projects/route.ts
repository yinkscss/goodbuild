import { NextResponse } from "next/server";
import { z } from "zod";
import { celo } from "viem/chains";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { recordingRootReader } from "@/server/goodid";
import {
  approveEntry,
  CommunityError,
  entryInput,
  listEntries,
  ownEntry,
  saveEntry,
} from "@/server/hackathon/community";
import { withRankMoves } from "@/server/hackathon/ranks";
import { parseEvent } from "@/lib/hackathon-events";
const headers = { "Cache-Control": "no-store" };
/** `?event=futminna` picks the hackathon (D160); without it, the main one. */
export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const event = parseEvent(params.get("event"));
    if (params.has("mine")) {
      const s = await requireSession();
      return NextResponse.json(await ownEntry(await getDb(), s.user.id, event), {
        headers,
      });
    }
    const db = await getDb();
    return NextResponse.json(await withRankMoves(db, await listEntries(db, event), new Date(), event), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    const event = parseEvent(new URL(request.url).searchParams.get("event"));
    const body = await request.json().catch(() => null);
    const approval = z.object({ entryId: z.uuid() }).safeParse(body);
    if (approval.success) {
      const db = await getDb();
      return NextResponse.json(
        await approveEntry(
          db,
          s.user,
          approval.data.entryId,
          recordingRootReader(db, s.user, publicClientFor(celo.id)),
          new Date(),
          event,
        ),
        { headers },
      );
    }
    const entry = entryInput.safeParse(body);
    if (!entry.success)
      return NextResponse.json(
        {
          message:
            "Add an alias, app name, a pitch up to 160 characters, and valid https:// links (or leave links empty).",
        },
        { status: 400 },
      );
    return NextResponse.json(
      await saveEntry(await getDb(), s.user, entry.data, event),
      { headers },
    );
  } catch (e) {
    if (e instanceof CommunityError)
      return NextResponse.json(
        { message: e.message },
        { status: e.status, headers },
      );
    return errorResponse(e);
  }
}
