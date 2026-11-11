import "server-only";

import { eq } from "drizzle-orm";

import type { Db } from "@/server/db/client";
import { users } from "@/server/db/schema";

export interface Preferences {
  /** Show "Built with GoodBuild" on the person's published apps. */
  showBadge: boolean;
}

export async function getPreferences(db: Db, userId: string): Promise<Preferences> {
  const [row] = await db.select({ showBadge: users.showBadge }).from(users).where(eq(users.id, userId)).limit(1);
  return { showBadge: row?.showBadge ?? true };
}

export async function setPreferences(db: Db, userId: string, patch: Partial<Preferences>): Promise<Preferences> {
  if (typeof patch.showBadge === "boolean") await db.update(users).set({ showBadge: patch.showBadge }).where(eq(users.id, userId));
  return getPreferences(db, userId);
}
