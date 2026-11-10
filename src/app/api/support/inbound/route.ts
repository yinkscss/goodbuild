import { NextResponse } from "next/server";

import { firstTime, forget, forwardReceived, verifyWebhook } from "@/server/support/inbound";

/** Resend calls this for every email sent to the support address (event email.received). Only a correctly signed call is believed. */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "not set up" }, { status: 503 });
  const raw = await request.text();
  if (raw.length > 256 * 1024) return NextResponse.json({ error: "too large" }, { status: 413 });
  const id = request.headers.get("svix-id");
  const ok = verifyWebhook(raw, { id, timestamp: request.headers.get("svix-timestamp"), signature: request.headers.get("svix-signature") }, secret);
  if (!ok) return NextResponse.json({ error: "bad signature" }, { status: 401 });

  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }
  const emailId = event.data?.email_id;
  if (event.type !== "email.received" || !emailId) return NextResponse.json({ ok: true, ignored: true });
  if (!firstTime(id!)) return NextResponse.json({ ok: true, duplicate: true });
  // A failure answers 500 so Resend retries; the id is forgotten so the retry isn't skipped.
  if (!(await forwardReceived(emailId))) {
    forget(id!);
    return NextResponse.json({ error: "could not forward" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
