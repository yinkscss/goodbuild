import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema";

/** Driver-agnostic handle: postgres-js in production, PGlite in dev and tests. */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/**
 * Postgres when DATABASE_URL is set (run `pnpm db:migrate` on deploy).
 * Otherwise an embedded PGlite database in .data/ so `pnpm dev` needs no setup;
 * it migrates itself on first use. Never use PGlite in production.
 */
async function create(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return drizzlePg(postgres(url, { max: 10, prepare: false }), { schema });
  }
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PGLITE !== "true") {
    throw new Error("DATABASE_URL is required in production.");
  }
  const dir = path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}

const globalForDb = globalThis as unknown as { __gbDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  globalForDb.__gbDb ??= create();
  return globalForDb.__gbDb;
}

/** Test helper: a fresh in-memory database with migrations applied. */
export async function createTestDb(): Promise<Db> {
  const db = drizzlePglite(new PGlite(), { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db;
}
