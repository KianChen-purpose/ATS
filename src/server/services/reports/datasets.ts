import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { STAGE_ORDER } from "./metrics";

/**
 * The custom report builder's catalogue (PRD §7.2). Everything a report definition can reference is
 * listed here: datasets, their date fields, dimensions and metrics. Definitions name these by key and
 * never carry SQL, so a saved report can't widen what the database returns. Every dataset joins
 * `jobs j`, which is what the visibility scope filters on.
 */

export type Format = "count" | "percent" | "days" | "hours" | "money";

export type Dimension = {
  key: string;
  label: string;
  /** Text expression; `tz` is the viewer's time zone for time buckets. */
  expr: (tz: string, dateCol: SQL) => SQL;
  /** Groups by named colleagues: per-person analytics (policy.canViewTeamAnalytics). */
  person?: boolean;
  /** Time bucket: sorts chronologically and allows a line chart. */
  time?: boolean;
  /** Sort key when values have a natural order (stage types). */
  order?: (tz: string, dateCol: SQL) => SQL;
};

export type Metric = {
  key: string;
  label: string;
  expr: SQL;
  format: Format;
  /** Compensation is a restricted field (ARCHITECTURE.md §3.5). */
  compensation?: boolean;
  description?: string;
};

export type RecordColumn = { key: string; label: string; format?: "date" | "money" | "text" };

export type Dataset = {
  key: string;
  label: string;
  description: string;
  /** Row noun for counts, e.g. "applications". */
  noun: string;
  from: SQL;
  dateFields: { key: string; label: string; col: SQL }[];
  dimensions: Dimension[];
  metrics: Metric[];
  /** Whole dataset is per-person (interviewer assignments). */
  person?: boolean;
  /** Underlying records for drill-down: id, candidate/job context and a few detail columns. */
  records: { select: SQL; columns: RecordColumn[]; orderBy: SQL; candidate: boolean };
};

const days = (expr: SQL) => sql`(extract(epoch from (${expr})) / 86400.0)`;
const median = (expr: SQL, filter?: SQL) =>
  filter
    ? sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}) FILTER (WHERE ${filter}))::float8`
    : sql`(percentile_cont(0.5) WITHIN GROUP (ORDER BY ${expr}))::float8`;
const share = (num: SQL, den: SQL) => sql`(${num})::float8 / NULLIF(${den}, 0)`;
const stageOrd = (col: SQL) => sql`array_position(ARRAY[${sql.raw(STAGE_ORDER.map((t) => `'${t}'`).join(","))}]::stage_type[], ${col})`;
const stageLabel = (col: SQL) =>
  sql`CASE ${col} WHEN 'lead' THEN 'Lead' WHEN 'review' THEN 'Application review' WHEN 'screen' THEN 'Screen' WHEN 'interview' THEN 'Interview' WHEN 'offer' THEN 'Offer' WHEN 'hired' THEN 'Hired' END`;
const initcap = (col: SQL) => sql`initcap(replace(${col}::text, '_', ' '))`;

const timeDims: Dimension[] = [
  { key: "week", label: "Week", time: true, expr: (tz, d) => sql`to_char(date_trunc('week', ${d} AT TIME ZONE ${tz}), 'YYYY-MM-DD')` },
  { key: "month", label: "Month", time: true, expr: (tz, d) => sql`to_char(date_trunc('month', ${d} AT TIME ZONE ${tz}), 'YYYY-MM')` },
  { key: "quarter", label: "Quarter", time: true, expr: (tz, d) => sql`to_char(date_trunc('quarter', ${d} AT TIME ZONE ${tz}), 'YYYY-"Q"Q')` },
];

const jobDims: Dimension[] = [
  { key: "brand", label: "Brand", expr: () => sql`b.name` },
  { key: "department", label: "Department", expr: () => sql`d.name` },
  { key: "location", label: "Location", expr: () => sql`loc.name` },
  { key: "job", label: "Job", expr: () => sql`j.title || ' · ' || b.name` },
  { key: "employment_type", label: "Employment type", expr: () => initcap(sql`j.employment_type`) },
  { key: "workplace_type", label: "Workplace", expr: () => initcap(sql`j.workplace_type`) },
  { key: "recruiter", label: "Recruiter", person: true, expr: () => sql`rec.name` },
  { key: "hiring_manager", label: "Hiring manager", person: true, expr: () => sql`hm.name` },
];
const jobJoins = sql`JOIN brands b ON b.id = j.brand_id
  LEFT JOIN departments d ON d.id = j.department_id
  LEFT JOIN locations loc ON loc.id = j.location_id
  LEFT JOIN users rec ON rec.id = j.recruiter_id
  LEFT JOIN users hm ON hm.id = j.hiring_manager_id`;

const candidateRecord = sql`c.id AS candidate_id, a.id AS application_id, c.first_name || ' ' || c.last_name AS candidate, j.id AS job_id, j.title || ' · ' || b.name AS job`;

export const DATASETS: Dataset[] = [
  {
    key: "applications",
    label: "Applications",
    description: "One row per application: a candidate on a job.",
    noun: "applications",
    from: sql`applications a
      JOIN jobs j ON j.id = a.job_id ${jobJoins}
      JOIN job_stages cs ON cs.id = a.stage_id
      JOIN candidates c ON c.id = a.candidate_id
      LEFT JOIN sources src ON src.id = a.source_id
      LEFT JOIN archive_reasons ar ON ar.id = a.archive_reason_id`,
    dateFields: [
      { key: "applied_at", label: "Applied", col: sql`a.applied_at` },
      { key: "hired_at", label: "Hired", col: sql`a.hired_at` },
      { key: "archived_at", label: "Archived", col: sql`a.archived_at` },
    ],
    dimensions: [
      ...timeDims,
      ...jobDims,
      { key: "stage_type", label: "Current stage type", expr: () => stageLabel(sql`cs.type`), order: () => stageOrd(sql`cs.type`) },
      { key: "stage", label: "Current stage", expr: () => sql`cs.name`, order: () => sql`cs.position` },
      { key: "status", label: "Status", expr: () => initcap(sql`a.status`) },
      { key: "source", label: "Source", expr: () => sql`src.name` },
      { key: "source_category", label: "Source type", expr: () => initcap(sql`src.category`) },
      { key: "archive_reason", label: "Archive reason", expr: () => sql`ar.name` },
      { key: "credited_to", label: "Credited to", person: true, expr: () => sql`(SELECT u.name FROM users u WHERE u.id = a.credited_to_id)` },
    ],
    metrics: [
      { key: "count", label: "Applications", format: "count", expr: sql`count(*)::int` },
      { key: "active", label: "Active", format: "count", expr: sql`count(*) FILTER (WHERE a.status = 'active')::int` },
      { key: "archived", label: "Archived", format: "count", expr: sql`count(*) FILTER (WHERE a.status = 'archived')::int` },
      { key: "hired", label: "Hired", format: "count", expr: sql`count(*) FILTER (WHERE a.status = 'hired')::int` },
      { key: "hire_rate", label: "Hire rate", format: "percent", expr: share(sql`count(*) FILTER (WHERE a.status = 'hired')`, sql`count(*)`) },
      {
        key: "reached_interview",
        label: "Reached interview",
        format: "count",
        description: "Reached an interview stage or later, per the stage history.",
        expr: sql`count(*) FILTER (WHERE a.status = 'hired' OR ${stageOrd(sql`cs.type`)} >= ${STAGE_ORDER.indexOf("interview") + 1} OR EXISTS (
          SELECT 1 FROM application_stage_events e JOIN job_stages es ON es.id = e.to_stage_id
          WHERE e.application_id = a.id AND ${stageOrd(sql`es.type`)} >= ${STAGE_ORDER.indexOf("interview") + 1}))::int`,
      },
      { key: "median_days_to_hire", label: "Median days to hire", format: "days", expr: median(days(sql`a.hired_at - a.applied_at`), sql`a.status = 'hired'`) },
      { key: "median_days_in_stage", label: "Median days in current stage", format: "days", expr: median(days(sql`now() - a.stage_entered_at`), sql`a.status = 'active'`) },
    ],
    records: {
      select: sql`${candidateRecord}, cs.name AS stage, initcap(a.status::text) AS status, src.name AS source, a.applied_at AS date`,
      columns: [
        { key: "stage", label: "Stage" },
        { key: "status", label: "Status" },
        { key: "source", label: "Source" },
        { key: "date", label: "Applied", format: "date" },
      ],
      orderBy: sql`a.applied_at DESC`,
      candidate: true,
    },
  },
  {
    key: "stage_moves",
    label: "Stage moves",
    description: "One row per change in the immutable stage history: moves, archives, hires.",
    noun: "stage moves",
    from: sql`application_stage_events e
      JOIN applications a ON a.id = e.application_id
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id ${jobJoins}
      LEFT JOIN job_stages fs ON fs.id = e.from_stage_id
      LEFT JOIN job_stages ts ON ts.id = e.to_stage_id
      LEFT JOIN users mv ON mv.id = e.moved_by_id`,
    dateFields: [{ key: "created_at", label: "Happened", col: sql`e.created_at` }],
    dimensions: [
      ...timeDims,
      ...jobDims,
      {
        key: "kind",
        label: "Kind of change",
        expr: () => sql`CASE WHEN e.from_stage_id IS NULL THEN 'Created' WHEN e.status = 'archived' THEN 'Archived' WHEN e.status = 'hired' THEN 'Hired'
          WHEN e.from_stage_id = e.to_stage_id THEN 'Unarchived' ELSE 'Moved' END`,
      },
      { key: "from_stage_type", label: "From stage type", expr: () => sql`COALESCE(${stageLabel(sql`fs.type`)}, '(new)')`, order: () => sql`COALESCE(${stageOrd(sql`fs.type`)}, 0)` },
      { key: "to_stage_type", label: "To stage type", expr: () => stageLabel(sql`ts.type`), order: () => stageOrd(sql`ts.type`) },
      { key: "to_stage", label: "To stage", expr: () => sql`ts.name` },
      { key: "moved_by", label: "Moved by", person: true, expr: () => sql`COALESCE(mv.name, '(automatic)')` },
    ],
    metrics: [
      { key: "count", label: "Stage moves", format: "count", expr: sql`count(*)::int` },
      { key: "applications", label: "Applications", format: "count", expr: sql`count(DISTINCT e.application_id)::int` },
    ],
    records: {
      select: sql`${candidateRecord}, COALESCE(fs.name, '(new)') || ' → ' || ts.name AS move, initcap(e.status::text) AS status, mv.name AS moved_by, e.created_at AS date`,
      columns: [
        { key: "move", label: "Move" },
        { key: "status", label: "Status after" },
        { key: "moved_by", label: "By" },
        { key: "date", label: "When", format: "date" },
      ],
      orderBy: sql`e.created_at DESC`,
      candidate: true,
    },
  },
  {
    key: "interviews",
    label: "Interviews",
    description: "One row per interview (a panel counts once).",
    noun: "interviews",
    from: sql`interviews i
      JOIN applications a ON a.id = i.application_id
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id ${jobJoins}
      LEFT JOIN job_stages ist ON ist.id = i.stage_id`,
    dateFields: [
      { key: "start_at", label: "Interview date", col: sql`i.start_at` },
      { key: "created_at", label: "Scheduled on", col: sql`i.created_at` },
    ],
    dimensions: [
      ...timeDims,
      ...jobDims,
      { key: "stage", label: "Interview stage", expr: () => sql`ist.name` },
      { key: "stage_type", label: "Stage type", expr: () => stageLabel(sql`ist.type`), order: () => stageOrd(sql`ist.type`) },
      { key: "status", label: "Status", expr: () => initcap(sql`i.status`) },
      { key: "scheduled_by", label: "Scheduled by", person: true, expr: () => sql`(SELECT u.name FROM users u WHERE u.id = i.created_by_id)` },
    ],
    metrics: [
      { key: "count", label: "Interviews", format: "count", expr: sql`count(*)::int` },
      { key: "completed", label: "Held", format: "count", expr: sql`count(*) FILTER (WHERE i.status <> 'cancelled' AND i.end_at < now())::int` },
      { key: "upcoming", label: "Upcoming", format: "count", expr: sql`count(*) FILTER (WHERE i.status = 'scheduled' AND i.start_at >= now())::int` },
      { key: "cancelled", label: "Cancelled", format: "count", expr: sql`count(*) FILTER (WHERE i.status = 'cancelled')::int` },
      {
        key: "with_feedback",
        label: "With all feedback in",
        format: "percent",
        description: "Share of held interviews where every interviewer submitted a scorecard.",
        expr: share(
          sql`count(*) FILTER (WHERE i.status <> 'cancelled' AND i.end_at < now() AND NOT EXISTS (
            SELECT 1 FROM interview_interviewers ii WHERE ii.interview_id = i.id
            AND NOT EXISTS (SELECT 1 FROM scorecards sc WHERE sc.interview_id = i.id AND sc.author_id = ii.user_id)))`,
          sql`count(*) FILTER (WHERE i.status <> 'cancelled' AND i.end_at < now())`,
        ),
      },
    ],
    records: {
      select: sql`${candidateRecord}, i.title AS interview, initcap(i.status::text) AS status, i.start_at AS date`,
      columns: [
        { key: "interview", label: "Interview" },
        { key: "status", label: "Status" },
        { key: "date", label: "When", format: "date" },
      ],
      orderBy: sql`i.start_at DESC`,
      candidate: true,
    },
  },
  {
    key: "interviewer_load",
    label: "Interviewer assignments",
    description: "One row per interviewer per interview, with their scorecard. Per-person data.",
    noun: "assignments",
    person: true,
    from: sql`interview_interviewers ii
      JOIN interviews i ON i.id = ii.interview_id
      JOIN users iu ON iu.id = ii.user_id
      JOIN applications a ON a.id = i.application_id
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id ${jobJoins}
      LEFT JOIN scorecards sc ON sc.interview_id = i.id AND sc.author_id = ii.user_id`,
    dateFields: [{ key: "start_at", label: "Interview date", col: sql`i.start_at` }],
    dimensions: [
      ...timeDims,
      ...jobDims,
      { key: "interviewer", label: "Interviewer", person: true, expr: () => sql`iu.name` },
      { key: "recommendation", label: "Recommendation", expr: () => sql`initcap(replace(sc.overall::text, '_', ' '))` },
    ],
    metrics: [
      { key: "count", label: "Assignments", format: "count", expr: sql`count(*) FILTER (WHERE i.status <> 'cancelled')::int` },
      { key: "submitted", label: "Scorecards", format: "count", expr: sql`count(sc.id)::int` },
      { key: "median_hours", label: "Median hours to submit", format: "hours", expr: median(sql`extract(epoch from (sc.submitted_at - i.end_at)) / 3600.0`, sql`sc.id IS NOT NULL`) },
      { key: "within_24h", label: "Within 24h", format: "percent", expr: share(sql`count(*) FILTER (WHERE sc.submitted_at <= i.end_at + interval '24 hours')`, sql`count(sc.id)`) },
      { key: "yes_rate", label: "Yes rate", format: "percent", expr: share(sql`count(*) FILTER (WHERE sc.overall IN ('yes', 'strong_yes'))`, sql`count(sc.id)`) },
    ],
    records: {
      select: sql`${candidateRecord}, iu.name AS interviewer, i.title AS interview, initcap(replace(sc.overall::text, '_', ' ')) AS recommendation, i.start_at AS date`,
      columns: [
        { key: "interviewer", label: "Interviewer" },
        { key: "interview", label: "Interview" },
        { key: "recommendation", label: "Recommendation" },
        { key: "date", label: "When", format: "date" },
      ],
      orderBy: sql`i.start_at DESC`,
      candidate: true,
    },
  },
  {
    key: "offers",
    label: "Offers",
    description: "One row per offer.",
    noun: "offers",
    from: sql`offers o
      JOIN applications a ON a.id = o.application_id
      JOIN candidates c ON c.id = a.candidate_id
      JOIN jobs j ON j.id = a.job_id ${jobJoins}`,
    dateFields: [
      { key: "created_at", label: "Created", col: sql`o.created_at` },
      { key: "sent_at", label: "Sent", col: sql`o.sent_at` },
      { key: "decided_at", label: "Decided", col: sql`o.decided_at` },
    ],
    dimensions: [
      ...timeDims,
      ...jobDims,
      { key: "status", label: "Status", expr: () => initcap(sql`o.status`) },
      { key: "decline_reason", label: "Decline reason", expr: () => sql`NULLIF(upper(left(trim(o.decline_reason), 1)) || lower(substr(trim(o.decline_reason), 2)), '')` },
      {
        key: "band_position",
        label: "Position in band",
        expr: () => sql`CASE WHEN (j.comp_min IS NULL AND j.comp_max IS NULL) OR o.currency <> j.currency THEN 'No band'
          WHEN o.base_salary < j.comp_min THEN 'Below band' WHEN o.base_salary > j.comp_max THEN 'Above band' ELSE 'Within band' END`,
      },
    ],
    metrics: [
      { key: "count", label: "Offers", format: "count", expr: sql`count(*)::int` },
      { key: "accepted", label: "Accepted", format: "count", expr: sql`count(*) FILTER (WHERE o.status = 'accepted')::int` },
      { key: "declined", label: "Declined", format: "count", expr: sql`count(*) FILTER (WHERE o.status = 'declined')::int` },
      { key: "acceptance_rate", label: "Acceptance", format: "percent", expr: share(sql`count(*) FILTER (WHERE o.status = 'accepted')`, sql`count(*) FILTER (WHERE o.status IN ('accepted', 'declined'))`) },
      { key: "median_days_to_decision", label: "Median days to decision", format: "days", expr: median(days(sql`o.decided_at - o.sent_at`), sql`o.decided_at IS NOT NULL AND o.sent_at IS NOT NULL`) },
      { key: "median_base", label: "Median base (CAD)", format: "money", compensation: true, expr: median(sql`o.base_salary::float8`, sql`o.currency = 'CAD'`) },
      { key: "avg_base", label: "Average base (CAD)", format: "money", compensation: true, expr: sql`(avg(o.base_salary) FILTER (WHERE o.currency = 'CAD'))::float8` },
    ],
    records: {
      select: sql`${candidateRecord}, initcap(replace(o.status::text, '_', ' ')) AS status, o.base_salary AS base, o.created_at AS date`,
      columns: [
        { key: "status", label: "Status" },
        { key: "base", label: "Base", format: "money" },
        { key: "date", label: "Created", format: "date" },
      ],
      orderBy: sql`o.created_at DESC`,
      candidate: true,
    },
  },
  {
    key: "openings",
    label: "Openings",
    description: "One row per opening (a unit of headcount on a job).",
    noun: "openings",
    from: sql`openings op JOIN jobs j ON j.id = op.job_id ${jobJoins}`,
    dateFields: [
      { key: "created_at", label: "Created", col: sql`op.created_at` },
      { key: "filled_at", label: "Filled", col: sql`op.filled_at` },
      { key: "target_start", label: "Target start", col: sql`op.target_start_date::timestamptz` },
    ],
    dimensions: [
      ...timeDims,
      ...jobDims,
      { key: "status", label: "Status", expr: () => initcap(sql`op.status`) },
      { key: "reason", label: "Reason", expr: () => initcap(sql`op.reason`) },
      { key: "job_status", label: "Job status", expr: () => initcap(sql`j.status`) },
    ],
    metrics: [
      { key: "count", label: "Openings", format: "count", expr: sql`count(*)::int` },
      { key: "open", label: "Open", format: "count", expr: sql`count(*) FILTER (WHERE op.status = 'open')::int` },
      { key: "filled", label: "Filled", format: "count", expr: sql`count(*) FILTER (WHERE op.status = 'filled')::int` },
      { key: "median_days_to_fill", label: "Median days to fill", format: "days", expr: median(days(sql`op.filled_at - op.created_at`), sql`op.status = 'filled'`) },
      { key: "median_age", label: "Median age of open", format: "days", expr: median(days(sql`now() - op.created_at`), sql`op.status = 'open'`) },
    ],
    records: {
      select: sql`NULL::uuid AS candidate_id, NULL::uuid AS application_id, op.code AS candidate, j.id AS job_id, j.title || ' · ' || b.name AS job, initcap(op.status::text) AS status, initcap(op.reason::text) AS reason, op.created_at AS date`,
      columns: [
        { key: "status", label: "Status" },
        { key: "reason", label: "Reason" },
        { key: "date", label: "Created", format: "date" },
      ],
      orderBy: sql`op.created_at DESC`,
      candidate: false,
    },
  },
];

export const datasetByKey = (key: string) => DATASETS.find((d) => d.key === key);
