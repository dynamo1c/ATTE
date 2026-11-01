import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env.");
  return url;
}

export function createPool(url = requireDatabaseUrl()) {
  const timeout = Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 60_000;
  const pool = new Pool({
    connectionString: url,
    max: Number(process.env.DB_POOL_MAX) || 10,
    // Fail fast instead of hanging a request when the database is down or the pool is exhausted.
    connectionTimeoutMillis: 10_000,
    // Every connection works in college time, so CURRENT_DATE matches the wall clock in Bengaluru.
    // A runaway query or a transaction left open can't hold locks forever.
    options: `-c timezone=Asia/Kolkata -c statement_timeout=${timeout} -c idle_in_transaction_session_timeout=${timeout}`,
  });
  // An idle connection dropped by the server (restart, network) emits 'error'; unhandled, it would crash the app.
  pool.on("error", (err) => console.error("Database connection lost (the pool will reconnect):", err.message));
  return pool;
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
