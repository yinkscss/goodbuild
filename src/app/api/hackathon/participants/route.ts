import { NextResponse } from "next/server";
import { errorResponse, requireSession } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import {
  getParticipant,
  participantInput,
  saveParticipant,
} from "@/server/hackathon/community";
export async function GET() {
  try {
    const s = await requireSession();
    return NextResponse.json(await getParticipant(await getDb(), s.user.id), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    const s = await requireSession();
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
      }),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
