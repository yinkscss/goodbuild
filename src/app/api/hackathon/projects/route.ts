import { NextResponse } from "next/server";
import { z } from "zod";
import { celo } from "viem/chains";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { publicClientFor } from "@/server/deploy/service";
import { readGoodIdRoot } from "@/server/goodid";
import {
  approveEntry,
  CommunityError,
  entryInput,
  listEntries,
  ownEntry,
  saveEntry,
} from "@/server/hackathon/community";
const headers = { "Cache-Control": "no-store" };
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.has("mine")) {
      const s = await requireSession();
      return NextResponse.json(await ownEntry(await getDb(), s.user.id), {
        headers,
      });
    }
    return NextResponse.json(await listEntries(await getDb()), { headers });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    const body = await request.json().catch(() => null);
    const approval = z.object({ entryId: z.uuid() }).safeParse(body);
    if (approval.success) {
      const client = publicClientFor(celo.id);
      return NextResponse.json(
        await approveEntry(
          await getDb(),
          s.user,
          approval.data.entryId,
          (wallet) => readGoodIdRoot(client, wallet),
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
      await saveEntry(await getDb(), s.user, entry.data),
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
