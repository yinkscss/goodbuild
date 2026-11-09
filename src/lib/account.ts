import { shortAddress } from "@/lib/format";

/** A contract is Live when it is the newest row for its project, network and name. Older ones were replaced by a redeploy. */
export function markLive<T extends { id: string; projectId: string; chainId: number; contractName: string; createdAt: Date | string }>(rows: T[]): Array<T & { live: boolean }> {
  const newest = new Map<string, { id: string; at: number }>();
  for (const r of rows) {
    const key = `${r.projectId}:${r.chainId}:${r.contractName}`;
    const at = new Date(r.createdAt).getTime();
    const cur = newest.get(key);
    if (!cur || at > cur.at) newest.set(key, { id: r.id, at });
  }
  return rows.map((r) => ({ ...r, live: newest.get(`${r.projectId}:${r.chainId}:${r.contractName}`)?.id === r.id }));
}

/**
 * Who saved a record, shortened for display: a wallet becomes 0x7a3…e41c, and "anon:" / "email:" ids
 * keep only their first characters. Anything else is not echoed at all.
 */
export function maskSubject(subject: string | null | undefined): string {
  if (!subject) return "Hidden";
  if (/^0x[0-9a-fA-F]{40}$/.test(subject)) return shortAddress(subject);
  const m = /^(anon|email):([0-9a-f-]{36})$/.exec(subject);
  if (m) return `${m[1] === "anon" ? "Visitor" : "Email visitor"} ${m[2].slice(0, 6)}…`;
  return "Visitor";
}
