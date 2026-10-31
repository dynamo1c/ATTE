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
