import { NextResponse } from "next/server";

import { countryFrom } from "@/server/geo";
import { SupportError, checkRate, deliverTicket, newTicketId, ticketSchema } from "@/server/support/ticket";

const MAX_BODY = 8 * 1024;

function clientIp(headers: Headers): string {
  // The firewall lets only Cloudflare reach the server, so its header is the visitor's address.
  return headers.get("cf-connecting-ip") ?? headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const fail = (error: SupportError) => NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });

/** Send a support ticket to the owner by email and Telegram. No sign-in needed: people who can't connect a wallet need help too. */
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) throw new SupportError("invalid", 413, "That message is too long.");
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      throw new SupportError("invalid", 400, "Something went wrong with the form. Please try again.");
    }
    const parsed = ticketSchema.safeParse(json);
    if (!parsed.success) throw new SupportError("invalid", 400, parsed.error.issues[0]?.message ?? "Please check the form.");
    const id = newTicketId();
    // A filled hidden field means a bot. Answer as if it worked, and send nothing.
    if (parsed.data.website) return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
    checkRate(clientIp(request.headers));
    await deliverTicket(id, parsed.data, countryFrom(request.headers));
    return NextResponse.json({ id }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SupportError) return fail(error);
    console.error("support ticket failed:", error);
    return fail(new SupportError("failed", 500, "Something went wrong. Please try again."));
  }
}
