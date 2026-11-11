import "server-only";

import { mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as coreSchema from "./schema";
import * as deploySchema from "./deploy-schema";
import * as publishSchema from "./publish-schema";
import * as appDataSchema from "./app-data-schema";
import * as settingsSchema from "./settings-schema";
import * as onchainCreditsSchema from "./onchain-credits-schema";
import * as creditQuotesSchema from "./credit-quotes-schema";
import * as githubSchema from "./github-schema";

const schema = { ...coreSchema, ...deploySchema, ...publishSchema, ...appDataSchema, ...settingsSchema, ...onchainCreditsSchema, ...creditQuotesSchema, ...githubSchema };

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
    return drizzlePg(postgres(url, { max: Number(process.env.DATABASE_POOL_MAX) || 10, prepare: false }), { schema });
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

let testDb: Promise<{ client: PGlite; db: Db }> | undefined;

/**
 * Test helper: an empty, migrated in-memory database. PGlite's wasm start-up takes seconds, so each
 * test file starts one and later calls empty its tables, which takes milliseconds. That means a new
 * call wipes what the previous call returned: a test can't hold two databases at once.
 */
export async function createTestDb(): Promise<Db> {
  testDb ??= (async () => {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema });
    await migratePglite(db, { migrationsFolder: MIGRATIONS });
    return { client, db };
  })();
  const { client, db } = await testDb;
  const { rows } = await client.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public'");
  // Migration 0010 refuses TRUNCATE on money records. This throwaway database turns triggers off to reset.
  await client.exec(`SET session_replication_role = replica; TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE; SET session_replication_role = DEFAULT;`);
  return db;
}
