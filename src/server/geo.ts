/**
 * Country gating (D10: no US persons; sanctioned jurisdictions excluded).
 * Reads the country header the host sets: Cloudflare (`cf-ipcountry`, our setup, D25) or
 * Vercel (`x-vercel-ip-country`). Cloudflare's comes first because it overwrites its own header
 * but passes a visitor's fake Vercel one through. With no header (local dev, a host with no
 * proxy) nothing is blocked, so the attestation is the only check there. IP geo is a backstop,
 * not proof.
 */
export const BLOCKED_COUNTRIES = new Set([
  "US", // GoodDollar ToS §8
  // Comprehensively sanctioned jurisdictions (UNVERIFIED list; confirm with counsel).
  "CU",
  "IR",
  "KP",
  "SY",
]);

type HeaderReader = { get(name: string): string | null };

export function countryFrom(headers: HeaderReader): string | null {
  const raw = headers.get("cf-ipcountry") ?? headers.get("x-vercel-ip-country");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function isBlockedRegion(headers: HeaderReader): boolean {
  const country = countryFrom(headers);
  return country !== null && BLOCKED_COUNTRIES.has(country);
}
