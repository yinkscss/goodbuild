import { timingSafeEqual } from "node:crypto";

/**
 * Vercel is the edge and Railway the backend (D26). The browser only talks to the edge, which
 * forwards to the backend with these headers. Only the shared secret makes them trustworthy: the
 * backend's own address is public, and anyone could send the headers to it.
 */
export const EDGE_HEADER = "x-gb-edge";
export const EDGE_HOST_HEADER = "x-gb-host";

type HeaderReader = { get(name: string): string | null };

export function isFromEdge(headers: HeaderReader, secret = process.env.EDGE_SECRET): boolean {
  const sent = headers.get(EDGE_HEADER);
  if (!secret || !sent) return false;
  const [a, b] = [Buffer.from(sent), Buffer.from(secret)];
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The host the visitor asked for. Behind the edge, Host is the backend's own address. */
export function effectiveHost(headers: HeaderReader): string | null {
  return (isFromEdge(headers) ? headers.get(EDGE_HOST_HEADER) : null) ?? headers.get("host");
}
