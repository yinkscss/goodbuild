/**
 * Country gating (D10: no US persons; sanctioned jurisdictions excluded).
 * Reads the country header the host sets: Vercel (`x-vercel-ip-country`) or
 * Cloudflare (`cf-ipcountry`). With no header (local dev, unknown host) nothing is
 * blocked, so the attestation is the only check there. IP geo is a backstop, not proof.
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
  const raw = headers.get("x-vercel-ip-country") ?? headers.get("cf-ipcountry");
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function isBlockedRegion(headers: HeaderReader): boolean {
  const country = countryFrom(headers);
  return country !== null && BLOCKED_COUNTRIES.has(country);
}
