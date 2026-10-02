import "server-only";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { reportingDb } from "@/db/reporting";
import type { UserActor } from "@/server/policy";
import { inWindow, jobScope, type ReportFilters } from "./filters";
import { STAGE_ORDER, STAGE_TYPE_LABELS } from "./metrics";
import { assertCanViewReports, cohortCte } from "./standard";

/**
 * Drill-down from a report number to the applications behind it (PRD §7.2). Uses the same filters
 * and the same definitions as the number, so the list always adds up to it, and it is trimmed to
 * visible jobs like every report.
 */
export const drillSchema = z.discriminatedUnion("set", [
  z.object({ set: z.literal("applied") }),
  z.object({ set: z.literal("hired") }),
  z.object({ set: z.literal("reached"), stage: z.enum(STAGE_ORDER) }),
  z.object({ set: z.literal("active_at"), stage: z.enum(STAGE_ORDER) }),
  z.object({ set: z.literal("archived_at"), stage: z.enum(STAGE_ORDER) }),
  z.object({ set: z.literal("source"), sourceId: z.union([z.uuid(), z.literal("none")]) }),
]);
export type DrillSet = z.infer<typeof drillSchema>;

export const DRILL_LIMIT = 500;

export function describeDrill(d: DrillSet, sourceName?: string) {
  switch (d.set) {
    case "applied":
      return "Applications in the date range";
    case "hired":
      return "Hires in the date range";
    case "reached":
      return `Applications that reached ${STAGE_TYPE_LABELS[d.stage]} or later`;
    case "active_at":
      return `Active applications now in ${STAGE_TYPE_LABELS[d.stage]}`;
    case "archived_at":
      return `Applications archived at ${STAGE_TYPE_LABELS[d.stage]}`;
    case "source":
      return `Applications from ${sourceName ?? "an unknown source"}`;
  }
}

export type DrillRow = {
  application_id: string;
  candidate_id: string;
  first_name: string;
  last_name: string;
  job_id: string;
  job_title: string;
  brand: string;
  stage: string;
  status: string;
  applied_at: string;
  hired_at: string | null;
  source: string | null;
};

export async function drillDown(actor: UserActor, f: ReportFilters, d: DrillSet) {
  assertCanViewReports(actor);
  let from: SQL;
  if (d.set === "hired") {
    from = sql`(SELECT a.id FROM applications a WHERE a.job_id IN (${jobScope(actor, f)}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}) AS pick`;
  } else {
    const ord = "stage" in d ? STAGE_ORDER.indexOf(d.stage) : 0;
    const where =
      d.set === "applied"
        ? sql`TRUE`
        : d.set === "reached"
          ? sql`c.max_ord >= ${ord}`
          : d.set === "active_at"
            ? sql`c.status = 'active' AND c.cur_ord = ${ord}`
            : d.set === "archived_at"
              ? sql`c.status = 'archived' AND c.cur_ord = ${ord}`
              : d.sourceId === "none"
                ? sql`c.source_id IS NULL`
                : sql`c.source_id = ${d.sourceId}`;
    from = sql`(WITH ${cohortCte(actor, f)} SELECT c.id FROM cohort c WHERE ${where}) AS pick`;
  }
  const result = await reportingDb.execute(sql`
    SELECT a.id AS application_id, c.id AS candidate_id, c.first_name, c.last_name, j.id AS job_id, j.title AS job_title,
      b.name AS brand, st.name AS stage, a.status::text AS status, a.applied_at, a.hired_at, src.name AS source
    FROM ${from}
    JOIN applications a ON a.id = pick.id
    JOIN candidates c ON c.id = a.candidate_id
    JOIN jobs j ON j.id = a.job_id
    JOIN brands b ON b.id = j.brand_id
    JOIN job_stages st ON st.id = a.stage_id
    LEFT JOIN sources src ON src.id = a.source_id
    ORDER BY a.applied_at DESC
    LIMIT ${DRILL_LIMIT + 1}
  `);
  const all = result.rows as DrillRow[];
  return { rows: all.slice(0, DRILL_LIMIT), truncated: all.length > DRILL_LIMIT };
}
