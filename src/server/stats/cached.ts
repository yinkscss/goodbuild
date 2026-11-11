import "server-only";

import { cacheLife } from "next/cache";

import { getDb } from "@/server/db/client";
import { loadPublicStats, type PublicStats } from "./public-stats";

/**
 * The public stats, worked out at most every ten minutes. /stats is open to anyone signed out, so
 * nobody can make it hit Postgres on every request. A failed read throws and is not cached.
 */
export async function getPublicStats(): Promise<PublicStats> {
  "use cache";
  cacheLife({ stale: 300, revalidate: 600, expire: 3600 });
  return loadPublicStats(await getDb());
}
