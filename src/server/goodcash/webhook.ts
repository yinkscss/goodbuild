import { createHmac, timingSafeEqual } from "node:crypto";

/** `GoodCash-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`, valid for 5 minutes (GoodCash webhook docs). */
export function verifyGoodCashSignature(raw: string, header: string | null, secret: string, nowS = Date.now() / 1000): boolean {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(header ?? "");
  if (!m || Math.abs(nowS - Number(m[1])) > 300) return false;
  const want = createHmac("sha256", secret).update(`${m[1]}.${raw}`).digest("hex");
  return timingSafeEqual(Buffer.from(want), Buffer.from(m[2]));
}
