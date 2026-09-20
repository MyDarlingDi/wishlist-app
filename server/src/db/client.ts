import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { migrate as migratePg } from "drizzle-orm/node-postgres/migrator";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import * as schema from "./schema.js";

export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: DB;
  close: () => Promise<void>;
}

const migrationsFolder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

/**
 * `postgres://…` → node-postgres pool (production).
 * unset / `pglite:<dir>` → embedded Postgres (local dev and tests only).
 * Migrations are applied on every start.
 */
export async function connectDb(url?: string): Promise<DbHandle> {
  if (url?.startsWith("postgres")) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder });
    return { db, close: () => pool.end() };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dir = url?.startsWith("pglite:") ? url.slice("pglite:".length) : undefined;
  const client = new PGlite(dir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder });
  return { db: db as unknown as DB, close: () => client.close() };
}
