import "dotenv/config";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, createPool } from "./client";

async function main() {
  const pool = createPool();
  try {
    await migrate(createDb(pool), { migrationsFolder: "./drizzle" });
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
