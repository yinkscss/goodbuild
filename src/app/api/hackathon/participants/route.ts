import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { parseEvent } from "@/lib/hackathon-events";
import {
  getParticipant,
  joinEvent,
  participantInput,
  saveParticipant,
} from "@/server/hackathon/community";
/**
 * `?event=futminna` (D160): the signup for that hackathon. Someone signed up only for the other one
 * gets that row back, so their email shows as saved; submitting then signs them up here too.
 */
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    const db = await getDb();
    const event = parseEvent(new URL(request.url).searchParams.get("event"));
    const row =
      (await getParticipant(db, s.user.id, event)) ??
      (event === "main" ? null : await getParticipant(db, s.user.id, "main"));
    return NextResponse.json(row, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
    const params = new URL(request.url).searchParams;
    const event = parseEvent(params.get("event"));
    // Joining another hackathon with the email already given (D160). Null when there is none yet.
    if (params.has("join"))
      return NextResponse.json(await joinEvent(await getDb(), s.user, event), {
        headers: { "Cache-Control": "no-store" },
      });
    const parsed = participantInput.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return NextResponse.json(
        { message: "Enter a valid email address." },
        { status: 400 },
      );
    return NextResponse.json(
      await saveParticipant(await getDb(), s.user, {
        ...parsed.data,
        email: s.user.email ?? parsed.data.email,
      }, event),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
