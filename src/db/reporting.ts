import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Read-only connection for reports, exports and the Power BI feed (ARCHITECTURE.md D10).
 *
 * Points at REPORTING_DATABASE_URL (the read replica or warehouse) when it is set. Until that store
 * exists it falls back to the primary database. Either way every session is read-only and has a
 * statement timeout, so a heavy report can't change data or hold the primary for long.
 * Imported only by services under src/server/services/reports.
 */
const globalForReporting = globalThis as unknown as { reportingPool?: Pool };

export const REPORT_STATEMENT_TIMEOUT_MS = 15_000;

const pool =
  globalForReporting.reportingPool ??
  new Pool({
    connectionString: process.env.REPORTING_DATABASE_URL || process.env.DATABASE_URL || "postgres://pats:pats@localhost:5432/pats",
    max: 4,
    options: `-c default_transaction_read_only=on -c statement_timeout=${REPORT_STATEMENT_TIMEOUT_MS}`,
  });
if (process.env.NODE_ENV !== "production") globalForReporting.reportingPool = pool;

export const reportingDb = drizzle(pool, { schema, casing: "snake_case" });

/** True when reports read from a separate store rather than the primary database. */
export const hasSeparateReportingStore = () => Boolean(process.env.REPORTING_DATABASE_URL);
