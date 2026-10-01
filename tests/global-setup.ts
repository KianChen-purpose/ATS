import { Pool } from "pg";
import { runMigrations } from "../src/db/migrate";

/** Creates a fresh test database and applies the committed migrations to it. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgres://pats:pats@localhost:5432/pats_test");
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to use non-test database "${dbName}".`);

  const admin = new URL(url);
  admin.pathname = "/postgres";
  const pool = new Pool({ connectionString: admin.toString() });
  await pool.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await pool.query(`CREATE DATABASE "${dbName}"`);
  await pool.end();

  await runMigrations(url.toString());
}
