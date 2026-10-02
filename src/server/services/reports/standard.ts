import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { reportingDb } from "@/db/reporting";
import { canViewCompensation, canViewReports, canViewTeamAnalytics, ForbiddenError, type UserActor } from "@/server/policy";
import { inWindow, jobScope, type ReportFilters } from "./filters";
import { MIN_SAMPLE, STAGE_ORDER, type StageTypeKey } from "./metrics";

/**
 * Out-of-the-box reports (PRD §7.1). Everything reads through the read-only reporting connection
 * (ARCHITECTURE.md D10) and is limited to jobs the actor can see (§3.4). Definitions: metrics.ts.
 */

export function assertCanViewReports(actor: UserActor) {
  if (!canViewReports(actor)) throw new ForbiddenError("Reports aren't available for your role.");
}
function assertTeam(actor: UserActor) {
  assertCanViewReports(actor);
  if (!canViewTeamAnalytics(actor)) throw new ForbiddenError("Team analytics aren't available for your role.");
}

async function rows<T>(query: SQL): Promise<T[]> {
  return (await reportingDb.execute(query)).rows as T[];
}

/** 0-based position of a stage type in STAGE_ORDER. */
export function stageOrd(col: SQL): SQL {
  return sql`(array_position(ARRAY[${sql.raw(STAGE_ORDER.map((t) => `'${t}'`).join(","))}]::stage_type[], ${col}) - 1)`;
}

const days = (expr: SQL) => sql`(extract(epoch from (${expr})) / 86400.0)`;
const median = (expr: SQL, filter?: SQL) =>
  filter
    ? sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${filter}))::float8`
    : sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}))::float8`;

/**
 * Applications created in the window, with the furthest stage type each one reached (from the stage
 * history, its current stage, and hired status) and its current stage type.
 */
export function cohortCte(actor: UserActor, f: ReportFilters): SQL {
  return sql`cohort AS (
    SELECT a.id, a.status, a.source_id, a.applied_at, a.hired_at, a.job_id, a.candidate_id,
      ${stageOrd(sql`cs.type`)} AS cur_ord,
      GREATEST(
        COALESCE((SELECT MAX(${stageOrd(sql`est.type`)}) FROM application_stage_events e JOIN job_stages est ON est.id = e.to_stage_id WHERE e.application_id = a.id), 0),
        ${stageOrd(sql`cs.type`)},
        CASE WHEN a.status = 'hired' THEN ${STAGE_ORDER.length - 1} ELSE 0 END
      ) AS max_ord
    FROM applications a
    JOIN job_stages cs ON cs.id = a.stage_id
    WHERE a.job_id IN (${jobScope(actor, f)}) AND ${inWindow(sql`a.applied_at`, f)}
  )`;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type WeeklyPoint = { week: string; applications: number; hires: number };

export async function getOverview(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const scope = jobScope(actor, f);
  const [totals] = await rows<{
    applications: number;
    hires: number;
    accepted: number;
    declined: number;
    tth: number | null;
    open_jobs: number;
    open_openings: number;
    active: number;
  }>(sql`
    SELECT
      (SELECT count(*)::int FROM applications a WHERE a.job_id IN (${scope}) AND ${inWindow(sql`a.applied_at`, f)}) AS applications,
      (SELECT count(*)::int FROM applications a WHERE a.job_id IN (${scope}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}) AS hires,
      (SELECT count(*)::int FROM offers o JOIN applications a ON a.id = o.application_id WHERE a.job_id IN (${scope}) AND o.status = 'accepted' AND ${inWindow(sql`o.decided_at`, f)}) AS accepted,
      (SELECT count(*)::int FROM offers o JOIN applications a ON a.id = o.application_id WHERE a.job_id IN (${scope}) AND o.status = 'declined' AND ${inWindow(sql`o.decided_at`, f)}) AS declined,
      (SELECT ${median(days(sql`a.hired_at - a.applied_at`))} FROM applications a WHERE a.job_id IN (${scope}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}) AS tth,
      (SELECT count(*)::int FROM jobs j WHERE j.id IN (${scope}) AND j.status = 'open') AS open_jobs,
      (SELECT count(*)::int FROM openings op WHERE op.job_id IN (${scope}) AND op.status = 'open') AS open_openings,
      (SELECT count(*)::int FROM applications a WHERE a.job_id IN (${scope}) AND a.status = 'active') AS active
  `);

  const weekly = await rows<WeeklyPoint>(sql`
    WITH weeks AS (
      SELECT generate_series(
        date_trunc('week', (${f.from.toISOString()}::timestamptz AT TIME ZONE ${f.tz})),
        date_trunc('week', ((${f.toExclusive.toISOString()}::timestamptz - interval '1 second') AT TIME ZONE ${f.tz})),
        interval '1 week') AS wk
    )
    SELECT to_char(w.wk, 'YYYY-MM-DD') AS week,
      (SELECT count(*)::int FROM applications a WHERE a.job_id IN (${scope}) AND ${inWindow(sql`a.applied_at`, f)}
        AND date_trunc('week', a.applied_at AT TIME ZONE ${f.tz}) = w.wk) AS applications,
      (SELECT count(*)::int FROM applications a WHERE a.job_id IN (${scope}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}
        AND date_trunc('week', a.hired_at AT TIME ZONE ${f.tz}) = w.wk) AS hires
    FROM weeks w ORDER BY w.wk
  `);

  const decided = totals.accepted + totals.declined;
  return {
    applications: totals.applications,
    hires: totals.hires,
    activeApplications: totals.active,
    openJobs: totals.open_jobs,
    openOpenings: totals.open_openings,
    offersAccepted: totals.accepted,
    offersDeclined: totals.declined,
    acceptanceRate: decided ? totals.accepted / decided : null,
    medianTimeToHire: totals.tth,
    weekly,
  };
}

// ---------------------------------------------------------------------------
// Pipeline funnel
// ---------------------------------------------------------------------------

export type FunnelRow = { stage: StageTypeKey; reached: number; active: number; archived: number; conversion: number | null };

export async function getFunnel(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const counts = await rows<{ ord: number; reached: number; active: number; archived: number }>(sql`
    WITH ${cohortCte(actor, f)}
    SELECT k.ord,
      (SELECT count(*)::int FROM cohort c WHERE c.max_ord >= k.ord) AS reached,
      (SELECT count(*)::int FROM cohort c WHERE c.status = 'active' AND c.cur_ord = k.ord) AS active,
      (SELECT count(*)::int FROM cohort c WHERE c.status = 'archived' AND c.cur_ord = k.ord) AS archived
    FROM generate_series(0, ${STAGE_ORDER.length - 1}) AS k(ord) ORDER BY k.ord
  `);
  const total = counts[0]?.reached ?? 0;
  const funnel: FunnelRow[] = counts.map((c, i) => {
    const next = counts[i + 1];
    return { stage: STAGE_ORDER[c.ord], reached: c.reached, active: c.active, archived: c.archived, conversion: next && c.reached ? next.reached / c.reached : null };
  });
  const archiveReasons = await rows<{ reason: string; category: string | null; n: number }>(sql`
    WITH ${cohortCte(actor, f)}
    SELECT COALESCE(r.name, 'No reason recorded') AS reason, r.category::text AS category, count(*)::int AS n
    FROM cohort c JOIN applications a ON a.id = c.id LEFT JOIN archive_reasons r ON r.id = a.archive_reason_id
    WHERE c.status = 'archived' GROUP BY 1, 2 ORDER BY n DESC, reason
  `);
  return { total, funnel, archiveReasons };
}

// ---------------------------------------------------------------------------
// Velocity
// ---------------------------------------------------------------------------

export async function getVelocity(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const scope = jobScope(actor, f);
  const [hire] = await rows<{ median: number | null; avg: number | null; n: number }>(sql`
    SELECT ${median(days(sql`a.hired_at - a.applied_at`))} AS median, avg(${days(sql`a.hired_at - a.applied_at`)})::float8 AS avg, count(*)::int AS n
    FROM applications a WHERE a.job_id IN (${scope}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}
  `);
  const [touch] = await rows<{ median: number | null; n: number; waiting: number }>(sql`
    WITH firsts AS (
      SELECT a.id, a.applied_at,
        (SELECT min(e.created_at) FROM application_stage_events e
          WHERE e.application_id = a.id AND e.moved_by_id IS NOT NULL
            AND e.created_at > (SELECT min(e0.created_at) FROM application_stage_events e0 WHERE e0.application_id = a.id)) AS touched_at
      FROM applications a WHERE a.job_id IN (${scope}) AND ${inWindow(sql`a.applied_at`, f)}
    )
    SELECT ${median(days(sql`touched_at - applied_at`), sql`touched_at IS NOT NULL`)} AS median,
      count(touched_at)::int AS n, count(*) FILTER (WHERE touched_at IS NULL)::int AS waiting
    FROM firsts
  `);
  const inStage = await rows<{ type: StageTypeKey; median: number; n: number }>(sql`
    WITH ev AS (
      SELECT e.status, st.type, e.created_at,
        LEAD(e.created_at) OVER (PARTITION BY e.application_id ORDER BY e.created_at, e.id) AS next_at
      FROM application_stage_events e
      JOIN applications a ON a.id = e.application_id
      JOIN job_stages st ON st.id = e.to_stage_id
      WHERE a.job_id IN (${scope})
    )
    SELECT type::text AS type, ${median(days(sql`next_at - created_at`))} AS median, count(*)::int AS n
    FROM ev WHERE status = 'active' AND type <> 'hired' AND next_at IS NOT NULL AND ${inWindow(sql`next_at`, f)}
    GROUP BY type ORDER BY ${stageOrd(sql`type`)}
  `);
  const [fill] = await rows<{ median: number | null; n: number }>(sql`
    SELECT ${median(days(sql`op.filled_at - op.created_at`))} AS median, count(*)::int AS n
    FROM openings op WHERE op.job_id IN (${scope}) AND op.status = 'filled' AND ${inWindow(sql`op.filled_at`, f)}
  `);
  const byJob = await rows<{ job_id: string; title: string; brand: string; hires: number; median: number }>(sql`
    SELECT j.id AS job_id, j.title, b.name AS brand, count(*)::int AS hires, ${median(days(sql`a.hired_at - a.applied_at`))} AS median
    FROM applications a JOIN jobs j ON j.id = a.job_id JOIN brands b ON b.id = j.brand_id
    WHERE a.job_id IN (${scope}) AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}
    GROUP BY j.id, j.title, b.name ORDER BY median DESC
  `);
  return {
    timeToHire: { median: hire.median, average: hire.avg, n: hire.n },
    timeToFirstTouch: { median: touch.median, n: touch.n, waiting: touch.waiting },
    timeToFill: { median: fill.median, n: fill.n },
    timeInStage: inStage,
    byJob,
  };
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export type SourceRow = { source_id: string | null; source: string; category: string | null; applications: number; interviewed: number; offers: number; hires: number };

export async function getSources(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const interviewOrd = STAGE_ORDER.indexOf("interview");
  const sources = await rows<SourceRow>(sql`
    WITH ${cohortCte(actor, f)}
    SELECT c.source_id, COALESCE(src.name, 'Unknown') AS source, src.category::text AS category,
      count(*)::int AS applications,
      count(*) FILTER (WHERE c.max_ord >= ${interviewOrd})::int AS interviewed,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM offers o WHERE o.application_id = c.id AND o.status NOT IN ('draft', 'withdrawn')))::int AS offers,
      count(*) FILTER (WHERE c.status = 'hired')::int AS hires
    FROM cohort c LEFT JOIN sources src ON src.id = c.source_id
    GROUP BY c.source_id, src.name, src.category
    ORDER BY applications DESC, source
  `);
  const byCategory = new Map<string, Omit<SourceRow, "source_id" | "source" | "category"> & { category: string }>();
  for (const r of sources) {
    const key = r.category ?? "unknown";
    const cur = byCategory.get(key) ?? { category: key, applications: 0, interviewed: 0, offers: 0, hires: 0 };
    cur.applications += r.applications;
    cur.interviewed += r.interviewed;
    cur.offers += r.offers;
    cur.hires += r.hires;
    byCategory.set(key, cur);
  }
  return { sources, categories: [...byCategory.values()].sort((a, b) => b.applications - a.applications) };
}

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export async function getOfferAnalytics(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const scope = jobScope(actor, f);
  const offersIn = sql`offers o JOIN applications a ON a.id = o.application_id JOIN jobs j ON j.id = a.job_id`;
  const byStatus = await rows<{ status: string; n: number }>(sql`
    SELECT o.status::text AS status, count(*)::int AS n FROM ${offersIn}
    WHERE a.job_id IN (${scope}) AND ${inWindow(sql`o.created_at`, f)} GROUP BY 1
  `);
  const [decided] = await rows<{ accepted: number; declined: number; median_days: number | null }>(sql`
    SELECT count(*) FILTER (WHERE o.status = 'accepted')::int AS accepted,
      count(*) FILTER (WHERE o.status = 'declined')::int AS declined,
      ${median(days(sql`o.decided_at - o.sent_at`), sql`o.sent_at IS NOT NULL`)} AS median_days
    FROM ${offersIn}
    WHERE a.job_id IN (${scope}) AND o.status IN ('accepted', 'declined') AND ${inWindow(sql`o.decided_at`, f)}
  `);
  const declineReasons = await rows<{ reason: string; n: number }>(sql`
    SELECT COALESCE(NULLIF(upper(left(trim(o.decline_reason), 1)) || lower(substr(trim(o.decline_reason), 2)), ''), 'No reason given') AS reason, count(*)::int AS n
    FROM ${offersIn}
    WHERE a.job_id IN (${scope}) AND o.status = 'declined' AND ${inWindow(sql`o.decided_at`, f)}
    GROUP BY 1 ORDER BY n DESC, reason
  `);

  // Compensation vs band is a restricted field (ARCHITECTURE.md §3.5).
  let band: { below: number; within: number; above: number; noBand: number; medianPctOfMidpoint: number | null } | null = null;
  if (canViewCompensation(actor)) {
    const [b] = await rows<{ below: number; within: number; above: number; no_band: number; pct: number | null }>(sql`
      SELECT
        count(*) FILTER (WHERE j.comp_min IS NOT NULL AND o.currency = j.currency AND o.base_salary < j.comp_min)::int AS below,
        count(*) FILTER (WHERE (j.comp_min IS NOT NULL OR j.comp_max IS NOT NULL) AND o.currency = j.currency
          AND o.base_salary >= COALESCE(j.comp_min, 0) AND o.base_salary <= COALESCE(j.comp_max, o.base_salary))::int AS within,
        count(*) FILTER (WHERE j.comp_max IS NOT NULL AND o.currency = j.currency AND o.base_salary > j.comp_max)::int AS above,
        count(*) FILTER (WHERE (j.comp_min IS NULL AND j.comp_max IS NULL) OR o.currency <> j.currency)::int AS no_band,
        ${median(sql`o.base_salary::float8 / ((j.comp_min + j.comp_max) / 2.0)`, sql`j.comp_min IS NOT NULL AND j.comp_max IS NOT NULL AND o.currency = j.currency`)} AS pct
      FROM ${offersIn}
      WHERE a.job_id IN (${scope}) AND o.status NOT IN ('draft', 'withdrawn') AND ${inWindow(sql`o.created_at`, f)}
    `);
    band = { below: b.below, within: b.within, above: b.above, noBand: b.no_band, medianPctOfMidpoint: b.pct };
  }
  const total = decided.accepted + decided.declined;
  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])) as Record<string, number>,
    accepted: decided.accepted,
    declined: decided.declined,
    acceptanceRate: total ? decided.accepted / total : null,
    medianDaysToDecision: decided.median_days,
    declineReasons,
    band,
  };
}

// ---------------------------------------------------------------------------
// Headcount & openings
// ---------------------------------------------------------------------------

export async function getHeadcount(actor: UserActor, f: ReportFilters) {
  assertCanViewReports(actor);
  const scope = jobScope(actor, f);
  const byBrand = await rows<{ brand_id: string; brand: string; open_jobs: number; open_openings: number; filled: number; created: number }>(sql`
    SELECT b.id AS brand_id, b.name AS brand,
      count(DISTINCT j.id) FILTER (WHERE j.status = 'open')::int AS open_jobs,
      count(op.id) FILTER (WHERE op.status = 'open')::int AS open_openings,
      count(op.id) FILTER (WHERE op.status = 'filled' AND ${inWindow(sql`op.filled_at`, f)})::int AS filled,
      count(op.id) FILTER (WHERE ${inWindow(sql`op.created_at`, f)})::int AS created
    FROM jobs j JOIN brands b ON b.id = j.brand_id LEFT JOIN openings op ON op.job_id = j.id
    WHERE j.id IN (${scope})
    GROUP BY b.id, b.name
    HAVING count(DISTINCT j.id) FILTER (WHERE j.status IN ('open', 'on_hold')) > 0 OR count(op.id) > 0
    ORDER BY b.name
  `);
  const aging = await rows<{ job_id: string; title: string; brand: string; status: string; days_open: number; open_openings: number; active: number; recruiter: string | null }>(sql`
    SELECT j.id AS job_id, j.title, b.name AS brand, j.status::text AS status,
      floor(${days(sql`now() - COALESCE(j.opened_at, j.created_at)`)})::int AS days_open,
      (SELECT count(*)::int FROM openings op WHERE op.job_id = j.id AND op.status = 'open') AS open_openings,
      (SELECT count(*)::int FROM applications a WHERE a.job_id = j.id AND a.status = 'active') AS active,
      u.name AS recruiter
    FROM jobs j JOIN brands b ON b.id = j.brand_id LEFT JOIN users u ON u.id = j.recruiter_id
    WHERE j.id IN (${scope}) AND j.status IN ('open', 'on_hold')
    ORDER BY days_open DESC, j.title
  `);
  const buckets = [
    { label: "0–30 days", min: 0, max: 30 },
    { label: "31–60 days", min: 31, max: 60 },
    { label: "61–90 days", min: 61, max: 90 },
    { label: "90+ days", min: 91, max: Infinity },
  ].map((bk) => ({ label: bk.label, jobs: aging.filter((j) => j.days_open >= bk.min && j.days_open <= bk.max).length }));
  return { byBrand, aging, buckets };
}

// ---------------------------------------------------------------------------
// Team: recruiter productivity & interviewer analytics (restricted)
// ---------------------------------------------------------------------------

export async function getRecruiterProductivity(actor: UserActor, f: ReportFilters) {
  assertTeam(actor);
  const scope = jobScope(actor, f);
  return rows<{ user_id: string; name: string; role: string; open_jobs: number; applications: number; moves: number; interviews: number; hires: number }>(sql`
    WITH people AS (
      SELECT j.recruiter_id AS id FROM jobs j WHERE j.id IN (${scope}) AND j.recruiter_id IS NOT NULL
      UNION
      SELECT e.moved_by_id FROM application_stage_events e JOIN applications a ON a.id = e.application_id
        WHERE a.job_id IN (${scope}) AND e.moved_by_id IS NOT NULL AND ${inWindow(sql`e.created_at`, f)}
      UNION
      SELECT i.created_by_id FROM interviews i JOIN applications a ON a.id = i.application_id
        WHERE a.job_id IN (${scope}) AND i.created_by_id IS NOT NULL AND ${inWindow(sql`i.created_at`, f)}
    )
    SELECT u.id AS user_id, u.name, u.role::text AS role,
      (SELECT count(*)::int FROM jobs j WHERE j.id IN (${scope}) AND j.recruiter_id = u.id AND j.status = 'open') AS open_jobs,
      (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id WHERE j.id IN (${scope}) AND j.recruiter_id = u.id AND ${inWindow(sql`a.applied_at`, f)}) AS applications,
      (SELECT count(*)::int FROM application_stage_events e JOIN applications a ON a.id = e.application_id
        WHERE a.job_id IN (${scope}) AND e.moved_by_id = u.id AND ${inWindow(sql`e.created_at`, f)}) AS moves,
      (SELECT count(*)::int FROM interviews i JOIN applications a ON a.id = i.application_id
        WHERE a.job_id IN (${scope}) AND i.created_by_id = u.id AND ${inWindow(sql`i.created_at`, f)}) AS interviews,
      (SELECT count(*)::int FROM applications a JOIN jobs j ON j.id = a.job_id
        WHERE j.id IN (${scope}) AND j.recruiter_id = u.id AND a.status = 'hired' AND ${inWindow(sql`a.hired_at`, f)}) AS hires
    FROM users u WHERE u.id IN (SELECT id FROM people) AND u.role IN ('admin', 'recruiter', 'coordinator')
    ORDER BY hires DESC, moves DESC, u.name
  `);
}

export type InterviewerRow = {
  user_id: string;
  name: string;
  interviews: number;
  submitted: number;
  median_hours: number | null;
  within_24h: number | null;
  positive_rate: number | null;
};

export async function getInterviewerAnalytics(actor: UserActor, f: ReportFilters) {
  assertTeam(actor);
  const scope = jobScope(actor, f);
  const list = await rows<InterviewerRow & { positive: number }>(sql`
    WITH ints AS (
      SELECT i.id, i.end_at, ii.user_id
      FROM interviews i
      JOIN interview_interviewers ii ON ii.interview_id = i.id
      JOIN applications a ON a.id = i.application_id
      WHERE a.job_id IN (${scope}) AND i.status <> 'cancelled' AND i.end_at < now() AND ${inWindow(sql`i.end_at`, f)}
    ), cards AS (
      SELECT ints.user_id, ints.end_at, sc.submitted_at, sc.overall
      FROM ints JOIN scorecards sc ON sc.interview_id = ints.id AND sc.author_id = ints.user_id
    )
    SELECT u.id AS user_id, u.name,
      (SELECT count(*)::int FROM ints WHERE ints.user_id = u.id) AS interviews,
      (SELECT count(*)::int FROM cards WHERE cards.user_id = u.id) AS submitted,
      (SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from (submitted_at - end_at)) / 3600.0))::float8 FROM cards WHERE cards.user_id = u.id) AS median_hours,
      (SELECT (avg(CASE WHEN submitted_at <= end_at + interval '24 hours' THEN 1.0 ELSE 0.0 END))::float8 FROM cards WHERE cards.user_id = u.id) AS within_24h,
      (SELECT count(*)::int FROM cards WHERE cards.user_id = u.id AND overall IN ('yes', 'strong_yes')) AS positive,
      NULL::float8 AS positive_rate
    FROM users u WHERE u.id IN (SELECT user_id FROM ints)
    ORDER BY interviews DESC, u.name
  `);
  const totalCards = list.reduce((n, r) => n + r.submitted, 0);
  const totalPositive = list.reduce((n, r) => n + r.positive, 0);
  const interviewers: InterviewerRow[] = list.map(({ positive, ...r }) => ({
    ...r,
    // Small samples say nothing about calibration; hide them rather than mislead.
    positive_rate: r.submitted >= MIN_SAMPLE ? positive / r.submitted : null,
  }));
  return { interviewers, overallPositiveRate: totalCards ? totalPositive / totalCards : null };
}
