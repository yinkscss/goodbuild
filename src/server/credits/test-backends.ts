import { randomBytes } from "node:crypto";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import postgres from "postgres";

import type { Db } from "@/server/db/client";
import * as schema from "@/server/db/schema";

/** A throwaway database, with a way to move it forward through the migrations. */
export interface TestDatabase {
  db: Db;
  migrate(folder: string): Promise<void>;
  close(): Promise<void>;
}

export interface TestBackend {
  name: string;
  /** PGlite has one connection, so only real Postgres can actually race. */
  realConcurrency: boolean;
  open(): Promise<TestDatabase>;
}

export const MIGRATIONS = path.join(process.cwd(), "drizzle");

const pglite: TestBackend = {
  name: "PGlite",
  realConcurrency: false,
  async open() {
    const client = new PGlite();
    const db = drizzlePglite(client, { schema }) as unknown as Db;
    return {
      db,
      migrate: (migrationsFolder) => migratePglite(db as never, { migrationsFolder }),
      close: () => client.close(),
    };
  },
};

/**
 * Money tests must also run on what production runs. TEST_DATABASE_URL names a local server, where
 * each test file makes its own database and drops it afterwards. It refuses anything else, so a
 * production URL in the environment can't be touched.
 */
function postgresBackend(url: string): TestBackend {
  const parsed = new URL(url);
  const host = parsed.hostname || new URLSearchParams(parsed.search).get("host") || "";
  if (!/^(localhost|127\.0\.0\.1|\[::1\])$/.test(host) && !host.startsWith("/")) {
    throw new Error(`TEST_DATABASE_URL must point at a local server, not ${host}`);
  }
  return {
    name: "Postgres",
    realConcurrency: true,
    async open() {
      const name = `goodbuild_test_${randomBytes(6).toString("hex")}`;
      const admin = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
      await admin.unsafe(`CREATE DATABASE ${name}`);
      const target = new URL(url);
      target.pathname = `/${name}`;
      // The same driver settings as client.ts, with room for the race tests.
      const client = postgres(target.toString(), { max: 20, prepare: false, onnotice: () => undefined });
      const db = drizzlePg(client, { schema }) as unknown as Db;
      return {
        db,
        migrate: (migrationsFolder) => migratePg(db as never, { migrationsFolder }),
        close: async () => {
          await client.end();
          await admin.unsafe(`DROP DATABASE ${name}`);
          await admin.end();
        },
      };
    },
  };
}

/** PGlite always. Real Postgres too when TEST_DATABASE_URL is set, for example
 * `TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres pnpm vitest run src/server/credits` against a
 * throwaway local server (`initdb` then `pg_ctl start`). Each test file makes and drops its own database. */
export function testBackends(): TestBackend[] {
  const url = process.env.TEST_DATABASE_URL;
  return url ? [pglite, postgresBackend(url)] : [pglite];
}
