import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { applyWebhookCashOut } from "@/server/ambassador/cashout";
import { cashOutMode, type GcCashOut } from "@/server/goodcash/client";
import { verifyGoodCashSignature } from "@/server/goodcash/webhook";

// POST /api/goodcash/webhook ← GoodCash (cashout.paid, .failed, .refunded, .expired, .delayed). Signed with
// GOODCASH_WEBHOOK_SECRET. Optional: the Referrals page also asks GoodCash for the status, so nothing depends on this.
// Repeats are harmless (applying the same status twice changes nothing). Answers fast, as GoodCash requires.
export async function POST(request: Request) {
  const secret = process.env.GOODCASH_WEBHOOK_SECRET?.trim();
  const mode = cashOutMode();
  if (!secret || !mode) return NextResponse.json({ error: "Not configured" }, { status: 503 });
  const raw = await request.text();
  if (!verifyGoodCashSignature(raw, request.headers.get("goodcash-signature"), secret)) return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  let event: { type?: string; mode?: string; data?: GcCashOut };
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Bad body" }, { status: 400 }); }
  // A test event never touches a live cash out, and the other way round.
  if ((event.mode && event.mode !== mode) || !event.type?.startsWith("cashout.") || event.type === "cashout.test" || !event.data?.id) return NextResponse.json({ ok: true });
  try {
    await applyWebhookCashOut(await getDb(), event.data);
  } catch (e) {
    console.error("[goodcash webhook]", e);
    return NextResponse.json({ error: "Try again" }, { status: 500 }); // GoodCash retries
  }
  return NextResponse.json({ ok: true });
}
