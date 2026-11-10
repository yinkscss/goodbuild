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

/**
 * Who a permission is for (D34).
 * - anyone: every visitor, signed in or not. For "create" this means no sign-in is needed.
 * - signed-in: a visitor signed in with a wallet (later, email). Not an anonymous visitor.
 * - writer: the visitor who saved the record.
 * - owner: the app's owner, the wallet that owns the project on GoodBuild. Set by the server, never by the app.
 */
export type DataRole = "anyone" | "signed-in" | "writer" | "owner";
export type FieldType = "string" | "number" | "boolean";

export interface CollectionRule {
  create: "anyone" | "signed-in" | "owner";
  read: DataRole[];
  update: ("writer")[];
  delete: ("writer" | "owner")[];
  /** Fields everyone can read, without who wrote the record. */
  public: string[];
  /** When set, records must be objects with exactly these fields. */
  fields: Record<string, FieldType> | null;
  /** No two records may share these field values. Each must be in `public`, or a refusal would reveal private data. */
  unique: string[];
}

/** What a record was saved under. A record is never more visible than this, whatever the rule later says. */
export interface RecordGrant {
  read: DataRole[];
  public: string[];
}

const ROLES: readonly DataRole[] = ["anyone", "signed-in", "writer", "owner"];
const CREATE: readonly string[] = ["anyone", "signed-in", "owner"];
const FIELD_TYPES: readonly string[] = ["string", "number", "boolean"];
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

export const PRIVATE_RULE: CollectionRule = { create: "signed-in", read: ["writer"], update: ["writer"], delete: ["writer"], public: [], fields: null, unique: [] };
const PUBLIC_READ_RULE: CollectionRule = { ...PRIVATE_RULE, read: ["anyone"] };

const RULE_EXAMPLE = `{"collections": {"notes": "private", "posts": "public-read", "bookings": {"create": "anyone", "read": ["writer", "owner"], "public": ["day"]}}}`;

function list(value: unknown, allowed: readonly string[], where: string, issues: string[]): string[] | null {
  const items = typeof value === "string" ? [value] : value;
  if (!Array.isArray(items) || items.some((v) => typeof v !== "string" || !allowed.includes(v))) {
    issues.push(`${where} must be one or more of: ${allowed.map((a) => `"${a}"`).join(", ")}.`);
    return null;
  }
  return [...new Set(items as string[])];
}

/** One collection's rule from the file, or null with the reason added to issues. */
function parseRule(name: string, raw: unknown, issues: string[]): CollectionRule | null {
  if (raw === "private") return PRIVATE_RULE;
  if (raw === "public-read") return PUBLIC_READ_RULE;
  const at = `Collection "${name}" in ${DATA_RULES_PATH}:`;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    issues.push(`${at} the rule must be "private", "public-read" or an object like ${RULE_EXAMPLE}.`);
    return null;
  }
  const r = raw as Record<string, unknown>;
  const known = ["create", "read", "update", "delete", "public", "fields", "unique"];
  const unknown = Object.keys(r).filter((k) => !known.includes(k));
  if (unknown.length) issues.push(`${at} unknown setting ${unknown.map((k) => `"${k}"`).join(", ")}. Use ${known.join(", ")}.`);
  const before = issues.length;
  const create = r.create === undefined ? "signed-in" : typeof r.create === "string" && CREATE.includes(r.create) ? r.create : (issues.push(`${at} "create" must be "anyone", "signed-in" or "owner".`), null);
  const read = r.read === undefined ? ["writer"] : list(r.read, ROLES, `${at} "read"`, issues);
  const update = r.update === undefined ? ["writer"] : Array.isArray(r.update) && r.update.length === 0 ? [] : list(r.update, ["writer"], `${at} "update"`, issues);
  const del = r.delete === undefined ? ["writer"] : list(r.delete, ["writer", "owner"], `${at} "delete"`, issues);
  let fields: Record<string, FieldType> | null = null;
  if (r.fields !== undefined && r.fields !== null) {
    if (!r.fields || typeof r.fields !== "object" || Array.isArray(r.fields)) issues.push(`${at} "fields" must look like {"name": "string", "seats": "number"}.`);
    else {
      fields = {};
      for (const [field, type] of Object.entries(r.fields)) {
        if (!FIELD_NAME.test(field)) issues.push(`${at} field "${field}": use letters, numbers and _, starting with a letter.`);
        else if (typeof type !== "string" || !FIELD_TYPES.includes(type)) issues.push(`${at} field "${field}" must be "string", "number" or "boolean".`);
        else fields[field] = type as FieldType;
      }
    }
  }
  const names = (value: unknown, label: string) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((f) => typeof f !== "string" || !FIELD_NAME.test(f))) {
      issues.push(`${at} "${label}" must be a list of field names.`);
      return [];
    }
    const missing = fields ? value.filter((f) => !Object.hasOwn(fields!, f)) : [];
    if (missing.length) issues.push(`${at} "${label}" names fields that aren't in "fields": ${missing.join(", ")}.`);
    return [...new Set(value as string[])];
  };
  const pub = names(r.public, "public");
  const unique = names(r.unique, "unique");
  const hidden = unique.filter((f) => !pub.includes(f) && !(read ?? []).includes("anyone"));
  if (hidden.length) issues.push(`${at} every "unique" field must also be in "public", because refusing a duplicate shows that it exists: ${hidden.join(", ")}.`);
  if (issues.length > before || !create || !read || !update || !del) return null;
  return { create: create as CollectionRule["create"], read: read as DataRole[], update: update as CollectionRule["update"], delete: del as CollectionRule["delete"], public: pub, fields, unique };
}

/** A rule for each declared collection, or what's wrong with the file. Undeclared collections are private. */
export function parseDataRules(source: string | undefined): { rules: Record<string, CollectionRule>; issues: string[] } {
  if (source === undefined) return { rules: {}, issues: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { rules: {}, issues: [`${DATA_RULES_PATH} isn't valid JSON.`] };
  }
  const collections = (parsed as { collections?: unknown } | null)?.collections;
  if (!collections || typeof collections !== "object" || Array.isArray(collections)) {
    return { rules: {}, issues: [`${DATA_RULES_PATH} must look like ${RULE_EXAMPLE}.`] };
  }
  const rules: Record<string, CollectionRule> = {};
  const issues: string[] = [];
  for (const [name, raw] of Object.entries(collections)) {
    if (!COLLECTION_NAME.test(name)) {
      issues.push(`Collection "${name}" in ${DATA_RULES_PATH}: use lowercase letters, numbers, - and _, starting with a letter (48 at most).`);
      continue;
    }
    const rule = parseRule(name, raw, issues);
    if (rule) rules[name] = rule;
  }
  return { rules, issues };
}

/**
 * The rule for a collection, from what was stored at publish. Only a rule the file declared counts,
 * so "constructor" isn't special, and anything unreadable falls back to private.
 */
export function ruleFor(rules: Record<string, unknown>, collection: string): CollectionRule {
  if (!Object.hasOwn(rules, collection)) return PRIVATE_RULE;
  const issues: string[] = [];
  return parseRule(collection, rules[collection], issues) ?? PRIVATE_RULE;
}

export function grantOf(rule: CollectionRule): RecordGrant {
  return { read: [...rule.read], public: [...rule.public] };
}

/** Plain words for a rule, for the people building and using the app. */
export function describeRule(rule: CollectionRule): { who: string; publicFields: string[] } {
  const r = new Set(rule.read);
  const who = r.has("anyone")
    ? "Anyone can read it"
    : r.has("signed-in")
      ? "Anyone signed in can read it"
      : r.has("owner") && r.has("writer")
        ? "Only you and the person who sent it can read it"
        : r.has("owner")
          ? "Only you can read it"
          : "Only the person who saved it can read it";
  return { who, publicFields: r.has("anyone") ? [] : rule.public };
}

/** How visitors may sign in to this app (D35). Wallet sign-in is always on; email codes only when asked for. */
export function parseSignIn(source: string | undefined): { email: boolean; issues: string[] } {
  if (source === undefined) return { email: false, issues: [] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return { email: false, issues: [] };
  }
  const signIn = (parsed as { signIn?: unknown } | null)?.signIn;
  if (signIn === undefined) return { email: false, issues: [] };
  if (!signIn || typeof signIn !== "object" || Array.isArray(signIn) || Object.keys(signIn).some((k) => k !== "email") || typeof (signIn as { email?: unknown }).email !== "boolean") {
    return { email: false, issues: [`${DATA_RULES_PATH}: "signIn" must look like {"email": true}.`] };
  }
  return { email: (signIn as { email: boolean }).email, issues: [] };
}

/**
 * One email address, or null. Exactly one recipient: no lists, no display names, no header tricks.
 * Dots and +tags are kept, because they can be different people.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (/[\s,;<>()[\]\\"'\u0000-\u001f\u007f]/.test(email)) return null;
  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, domain] = parts;
  if (!local || local.length > 64 || !/^[a-z0-9.!#$%&*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) return null;
  return email;
}

// ---------------------------------------------------------------------------
// Queries (D78)

export type QueryOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";
export const QUERY_OPS: readonly QueryOp[] = ["eq", "ne", "gt", "gte", "lt", "lte"];
export const MAX_WHERE = 4;
/** The newest records a query reads before it stops. Bounds the work one request can cost. */
export const QUERY_SCAN_LIMIT = 500;

export interface QueryClause {
  field: string;
  op: QueryOp;
  value: string | number | boolean;
}

export interface RecordQuery {
  where: QueryClause[];
  /** A field of the record's value, or "createdAt" / "updatedAt". Absent: newest first. */
  order?: { field: string; dir: "asc" | "desc" };
  /** Only records saved or changed after this time (milliseconds since 1970). For polling. */
  since?: number;
}

export const isQuery = (q: RecordQuery | undefined): q is RecordQuery => Boolean(q && (q.where.length || q.order || q.since !== undefined));

const FIELD = /^[A-Za-z][A-Za-z0-9_]{0,47}$/;

/** One "where" clause as the data API receives it: field~op~value, the value as JSON ("5", "true", "\"open\"") or plain text. */
export function parseClause(text: string): QueryClause | string {
  const [field, op, ...rest] = text.split("~");
  const raw = rest.join("~");
  if (!field || !FIELD.test(field)) return `where: "${field ?? ""}" isn't a field name.`;
  if (!op || !(QUERY_OPS as readonly string[]).includes(op)) return `where: the comparison must be one of ${QUERY_OPS.join(", ")}.`;
  if (raw.length === 0 || raw.length > 200) return "where: give a value of up to 200 characters.";
  let value: unknown = raw;
  try {
    value = JSON.parse(raw);
  } catch {
    // Plain text is a string.
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return "where: the value must be text, a number or true or false.";
  return { field, op: op as QueryOp, value };
}

/** Does a value pass a clause? A field the viewer can't see, or of another type, never matches: a filter must not reveal what a viewer can't read. */
export function matchesClause(value: unknown, clause: QueryClause): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, clause.field)) return false;
  const got = (value as Record<string, unknown>)[clause.field];
  if (typeof got !== typeof clause.value) return false;
  if (clause.op === "eq") return got === clause.value;
  if (clause.op === "ne") return got !== clause.value;
  // Order comparisons: numbers and text only, and the same type on both sides (checked above).
  if (typeof got === "boolean") return false;
  const a = got as string | number;
  const b = clause.value as string | number;
  return clause.op === "gt" ? a > b : clause.op === "gte" ? a >= b : clause.op === "lt" ? a < b : a <= b;
}

/** The records a query keeps, in its order. `get` reads what the viewer sees of a record. */
export function applyQuery<T extends { value: unknown; createdAt: Date | string; updatedAt: Date | string }>(records: T[], query: RecordQuery): T[] {
  const kept = records.filter((r) => query.where.every((c) => matchesClause(r.value, c)));
  const order = query.order;
  if (!order) return kept;
  const sign = order.dir === "asc" ? 1 : -1;
  const keyOf = (r: T): string | number | boolean | null => {
    if (order.field === "createdAt" || order.field === "updatedAt") return new Date(r[order.field]).getTime();
    const v = r.value && typeof r.value === "object" && !Array.isArray(r.value) ? (r.value as Record<string, unknown>)[order.field] : undefined;
    return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;
  };
  // Records without the field go last, in either direction. Mixed types sort by type name first, so the order is always total.
  return [...kept].sort((a, b) => {
    const x = keyOf(a);
    const y = keyOf(b);
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1;
    if (typeof x !== typeof y) return typeof x < typeof y ? -sign : sign;
    return x === y ? 0 : x < y ? -sign : sign;
  });
}
