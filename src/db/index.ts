import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as { pool?: Pool };

// Reuse the pool across hot reloads in dev.
const pool =
  globalForDb.pool ??
  new Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://pats:pats@localhost:5432/pats" });
if (process.env.NODE_ENV !== "production") globalForDb.pool = pool;

export const db = drizzle(pool, { schema, casing: "snake_case" });
export { schema };
export type DB = typeof db;
