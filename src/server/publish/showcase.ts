import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { publications } from "@/server/db/publish-schema";
import { projects } from "@/server/db/schema";

export const PUBLISHED_APPS_SHOWCASE_LIMIT = 6;

/** Recent public apps only. Unpublished apps and admin takedowns never appear in the landing gallery. */
function publishedApps(db: Db, limit?: number) {
  const query = db
    .select({ slug: publications.slug, name: projects.name })
    .from(publications)
    .innerJoin(projects, eq(publications.projectId, projects.id))
    .where(and(isNull(publications.unpublishedAt), isNull(publications.disabledAt)))
    .orderBy(desc(publications.publishedAt), desc(publications.id));
  return limit === undefined ? query : query.limit(limit);
}

export function latestPublishedApps(db: Db) {
  return publishedApps(db, PUBLISHED_APPS_SHOWCASE_LIMIT);
}

/** Every currently published app for the public community directory. */
export function allPublishedApps(db: Db) {
  return publishedApps(db);
}
