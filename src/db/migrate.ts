/**
 * Applies the committed SQL migrations in ./drizzle.
 *   npm run db:migrate          apply pending migrations
 *   npm run db:reset            drop everything, migrate from scratch, reseed (local only)
 */
import "dotenv/config";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export async function runMigrations(url: string, opts: { reset?: boolean } = {}) {
  const pool = new Pool({ connectionString: url });
  try {
    if (opts.reset) {
      if (process.env.NODE_ENV === "production") throw new Error("Refusing to reset a production database.");
      await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    }
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required.");
  runMigrations(url, { reset: process.argv.includes("--reset") })
    .then(() => console.log("Migrations applied."))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
