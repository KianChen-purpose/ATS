import "server-only";
import { sql } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { reportingDb } from "@/db/reporting";
import type { UserActor } from "@/server/policy";
import { jobScope, type ReportFilters } from "./filters";
import { STAGE_ORDER, type StageTypeKey } from "./metrics";
import { assertCanViewReports } from "./standard";

/**
 * Point-in-time pipeline (PRD §7.2): "what did the pipeline look like on March 1?". Rebuilt from the
 * immutable stage history: each application's state at a moment is its latest stage event at or
 * before that moment. Nothing is read from the applications' current stage or status.
 */

export type SnapshotJob = {
  jobId: string;
  title: string;
  brand: string;
  active: Record<StageTypeKey, number>;
  activeTotal: number;
  archived: number;
  hired: number;
};

const emptyCounts = () => Object.fromEntries(STAGE_ORDER.map((t) => [t, 0])) as Record<StageTypeKey, number>;

/** End of `day` (YYYY-MM-DD) in the viewer's time zone, as a UTC instant. */
export function endOfDay(day: string, tz: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(new TZDate(y, m - 1, d + 1, tz).getTime() - 1);
}

async function stateAt(actor: UserActor, f: ReportFilters, at: Date) {
  const result = await reportingDb.execute(sql`
    WITH state AS (
      SELECT DISTINCT ON (e.application_id) e.application_id, e.to_stage_id, e.status
      FROM application_stage_events e
      JOIN applications a ON a.id = e.application_id
      WHERE a.job_id IN (${jobScope(actor, f)}) AND e.created_at <= ${at.toISOString()}::timestamptz
      ORDER BY e.application_id, e.created_at DESC, e.id DESC
    )
    SELECT a.job_id, j.title, b.name AS brand, st.type::text AS type, s.status::text AS status, count(*)::int AS n
    FROM state s
    JOIN applications a ON a.id = s.application_id
    JOIN jobs j ON j.id = a.job_id
    JOIN brands b ON b.id = j.brand_id
    JOIN job_stages st ON st.id = s.to_stage_id
    GROUP BY a.job_id, j.title, b.name, st.type, s.status
  `);
  const jobs = new Map<string, SnapshotJob>();
  for (const r of result.rows as { job_id: string; title: string; brand: string; type: StageTypeKey; status: string; n: number }[]) {
    const job = jobs.get(r.job_id) ?? { jobId: r.job_id, title: r.title, brand: r.brand, active: emptyCounts(), activeTotal: 0, archived: 0, hired: 0 };
    if (r.status === "active") {
      job.active[r.type] += r.n;
      job.activeTotal += r.n;
    } else if (r.status === "archived") job.archived += r.n;
    else if (r.status === "hired") job.hired += r.n;
    jobs.set(r.job_id, job);
  }
  return [...jobs.values()];
}

function totals(jobs: SnapshotJob[]) {
  const active = emptyCounts();
  for (const j of jobs) for (const t of STAGE_ORDER) active[t] += j.active[t];
  return {
    active,
    activeTotal: jobs.reduce((n, j) => n + j.activeTotal, 0),
    archived: jobs.reduce((n, j) => n + j.archived, 0),
    hired: jobs.reduce((n, j) => n + j.hired, 0),
  };
}

/** The pipeline at the end of `asOfDay`, next to the pipeline now. Brand/department/job filters apply; the date range doesn't. */
export async function getPipelineSnapshot(actor: UserActor, f: ReportFilters, asOfDay: string, now = new Date()) {
  assertCanViewReports(actor);
  const at = endOfDay(asOfDay, f.tz);
  const [then, current] = await Promise.all([stateAt(actor, f, at < now ? at : now), stateAt(actor, f, now)]);
  const currentById = new Map(current.map((j) => [j.jobId, j]));
  const thenById = new Map(then.map((j) => [j.jobId, j]));
  // Jobs that had no applications yet on that day still show, with zeros, if they're active now.
  for (const j of current) if (!thenById.has(j.jobId)) thenById.set(j.jobId, { ...j, active: emptyCounts(), activeTotal: 0, archived: 0, hired: 0 });
  const jobs = [...thenById.values()]
    .filter((j) => j.activeTotal > 0 || (currentById.get(j.jobId)?.activeTotal ?? 0) > 0)
    .sort((a, b) => b.activeTotal - a.activeTotal || a.title.localeCompare(b.title))
    .map((j) => ({ ...j, activeNow: currentById.get(j.jobId)?.activeTotal ?? 0 }));
  return { asOf: at, jobs, then: totals(then), now: totals(current) };
}
