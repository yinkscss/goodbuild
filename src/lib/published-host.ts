/**
 * Published apps live on <slug>.<domain>. Generated code must never run on the main site's origin,
 * where it could call the API as whoever is signed in, and a subdomain per app also keeps each
 * app's wallet permissions separate.
 */

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

/** Infrastructure names, plus names a published app could use to pass as an official one. */
const RESERVED = new Set([
  "www", "app", "apps", "api", "admin", "docs", "help", "support", "status", "mail", "email", "blog", "cdn", "assets", "static", "dev", "staging", "test", "preview", "login", "auth", "account", "dashboard",
  "goodbuild", "gooddollar", "gooddapp", "celo", "minipay", "valora", "metamask", "wallet", "official", "security",
]);

/**
 * A project's preview host (D69): pv-<32 hex>. The label is derived from the project on the server
 * and can't be guessed, and no app can be published under a name of this shape.
 */
const PREVIEW_LABEL = /^pv-([0-9a-f]{32})$/;

export function previewLabel(token: string): string {
  return `pv-${token}`;
}

export type SlugProblem = "invalid" | "reserved";

export function slugProblem(slug: string): SlugProblem | null {
  if (!SLUG.test(slug) || slug.includes("--")) return "invalid";
  return RESERVED.has(slug) || PREVIEW_LABEL.test(slug) ? "reserved" : null;
}

/** A starting suggestion from the project name. May still be taken. */
export function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slugProblem(base) ? `${base || "my"}-app`.replace(/^-+/, "") : base;
}

export function publishedAppsDomain(env: Record<string, string | undefined> = process.env): string {
  return (env.PUBLISHED_APPS_DOMAIN ?? (env.NODE_ENV === "production" ? "goodbuildit.xyz" : "localhost")).toLowerCase();
}

export type HostKind = { kind: "main" } | { kind: "app"; slug: string } | { kind: "preview"; token: string } | { kind: "unknown" };

/** What a request's Host header means. Reserved labels are left to the main site. */
export function classifyHost(host: string | null, domain: string): HostKind {
  const hostname = (host ?? "").split(":")[0].toLowerCase();
  if (hostname === domain || !hostname.endsWith(`.${domain}`)) return { kind: "main" };
  const label = hostname.slice(0, -(domain.length + 1));
  const preview = PREVIEW_LABEL.exec(label);
  if (preview) return { kind: "preview", token: preview[1] };
  const problem = slugProblem(label);
  if (problem === "reserved") return { kind: "main" };
  return problem ? { kind: "unknown" } : { kind: "app", slug: label };
}

/** The public address. In development it keeps the port the workspace is running on. */
export function publishedAppUrl(slug: string, requestHost: string | null, domain: string): string {
  if (domain !== "localhost") return `https://${slug}.${domain}`;
  const port = (requestHost ?? "").split(":")[1];
  return `http://${slug}.localhost${port ? `:${port}` : ""}`;
}
