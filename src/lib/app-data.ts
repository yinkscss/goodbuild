/**
 * The data API's public contract, shared by the proxy, the server and the build checks
 * (docs/APP_DATA.md). No server imports: proxy.ts and the agent's checks read this too.
 */

/** Where a published app reaches its data, on its own host. */
export const DATA_PATH_PREFIX = "/__gb/data/";
/** The internal route that prefix is rewritten to. Doesn't exist on the main site. */
export const DATA_ROUTE_PREFIX = "/app-data";
/** The file a generated app declares its collection rules in. */
export const DATA_RULES_PATH = "src/lib/dataRules.json";
export const DATA_CLIENT_HEADER = "x-gb-client";

export const COLLECTION_NAME = /^[a-z][a-z0-9_-]{0,47}$/;
/** Starts with a letter or digit, so "." and ".." can never be a key. */
export const RECORD_KEY = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

export type DataAccess = "private" | "public-read";
export const DATA_ACCESS: readonly string[] = ["private", "public-read"];

/** A rule for each declared collection, or what's wrong with the file. Undeclared collections are private. */
export function parseDataRules(source: string | undefined): { rules: Record<string, DataAccess>; issues: string[] } {
  if (source === undefined) return { rules: {}, issues: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { rules: {}, issues: [`${DATA_RULES_PATH} isn't valid JSON.`] };
  }
  const collections = (parsed as { collections?: unknown } | null)?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
    return { rules: {}, issues: [`${DATA_RULES_PATH} must look like {"collections": {"posts": "public-read", "notes": "private"}}.`] };
  }
  const rules: Record<string, DataAccess> = {};
  const issues: string[] = [];
  for (const [name, access] of Object.entries(collections)) {
    if (!COLLECTION_NAME.test(name)) issues.push(`Collection "${name}" in ${DATA_RULES_PATH}: use lowercase letters, numbers, - and _, starting with a letter (48 at most).`);
    else if (typeof access !== "string" || !DATA_ACCESS.includes(access)) issues.push(`Collection "${name}" in ${DATA_RULES_PATH}: the rule must be "private" or "public-read".`);
    else rules[name] = access as DataAccess;
  }
  return { rules, issues };
}

/** The rule for a collection. Only a rule the file declares counts, so "constructor" isn't special. */
export function accessFor(rules: Record<string, unknown>, collection: string): DataAccess {
  return Object.hasOwn(rules, collection) && rules[collection] === "public-read" ? "public-read" : "private";
}
