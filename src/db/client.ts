import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}

export function createPool(url = requireDatabaseUrl()) {
  // Every connection works in college time, so CURRENT_DATE matches the wall clock in Bengaluru.
  return new Pool({ connectionString: url, max: 10, options: "-c timezone=Asia/Kolkata" });
}

export function createDb(pool = createPool()) {
  return drizzle(pool, { schema, casing: "snake_case" });
}

export type Db = ReturnType<typeof createDb>;

// One pool per server process (survives Next.js hot reload in dev).
const globalForDb = globalThis as unknown as { __db?: Db };
export function getDb(): Db {
  globalForDb.__db ??= createDb();
  return globalForDb.__db;
}

/** A transaction handle (same query API as Db). */
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Either: lets jobs run inside a caller's transaction (tests roll it back). */
export type DbOrTx = Db | DbTx;

/**
 * Run independent queries: in parallel on the pool, one after another inside a transaction
 * (a transaction is a single connection, which can only run one query at a time).
 */
export async function inParallel<T extends readonly (() => Promise<unknown>)[]>(db: DbOrTx, tasks: T): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  if (!("rollback" in db)) return Promise.all(tasks.map((t) => t())) as never;
  const out: unknown[] = [];
  for (const t of tasks) out.push(await t());
  return out as never;
}
