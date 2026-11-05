/**
 * Country gating (D10: no US persons; sanctioned jurisdictions excluded).
 * Reads the country header the host sets, and on Vercel (our edge, D26) only Vercel's: it overwrites
 * its own header but passes a visitor's fake `cf-ipcountry` through. GEO_COUNTRY_HEADER names the
 * header for any other proxy. With no header (local dev, a host with no proxy) nothing is blocked,
 * so the attestation is the only check there. IP geo is a backstop, not proof.
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

function trustedHeaders(env: Record<string, string | undefined>): string[] {
  if (env.GEO_COUNTRY_HEADER) return [env.GEO_COUNTRY_HEADER];
  return env.VERCEL ? ["x-vercel-ip-country"] : ["cf-ipcountry", "x-vercel-ip-country"];
}

export function countryFrom(headers: HeaderReader, env: Record<string, string | undefined> = process.env): string | null {
  const raw = trustedHeaders(env).map((h) => headers.get(h)).find(Boolean);
  if (!raw) return null;
  const code = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function isBlockedRegion(headers: HeaderReader): boolean {
  const country = countryFrom(headers);
  return country !== null && BLOCKED_COUNTRIES.has(country);
}
