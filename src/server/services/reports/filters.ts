import "server-only";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { TZDate } from "@date-fns/tz";
import { visibleJobIds, type UserActor } from "@/server/policy";

/**
 * The filter row every report shares (PRD §7.1). Dates are calendar days in the viewer's time zone;
 * `to` is inclusive for people and converted to an exclusive UTC bound for SQL.
 */
export const RANGE_PRESETS = ["30d", "90d", "180d", "365d", "ytd", "custom"] as const;
export type RangePreset = (typeof RANGE_PRESETS)[number];

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const reportFiltersSchema = z.object({
  range: z.enum(RANGE_PRESETS).default("90d"),
  from: day.optional(),
  to: day.optional(),
  brandId: z.uuid().optional(),
  departmentId: z.uuid().optional(),
  jobId: z.uuid().optional(),
});
export type ReportFilterInput = z.input<typeof reportFiltersSchema>;

export type ReportFilters = {
  range: RangePreset;
  /** Inclusive calendar days, YYYY-MM-DD, in the viewer's time zone. */
  fromDay: string;
  toDay: string;
  /** UTC instants: [from, toExclusive). */
  from: Date;
  toExclusive: Date;
  brandId?: string;
  departmentId?: string;
  jobId?: string;
  tz: string;
};

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: TZDate) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfDay(dayStr: string, tz: string) {
  const [y, m, d] = dayStr.split("-").map(Number);
  return new TZDate(y, m - 1, d, tz);
}

/** Turns loose search params into concrete filters. Invalid values fall back to the defaults. */
export function resolveFilters(actor: UserActor, raw: Record<string, unknown>, now = new Date()): ReportFilters {
  // Field by field, so one bad value (say a stale job id) doesn't reset the others.
  const shape = reportFiltersSchema.shape;
  const field = <K extends keyof typeof shape>(k: K) => {
    const r = shape[k].safeParse(typeof raw[k] === "string" && raw[k] !== "" ? raw[k] : undefined);
    return (r.success ? r.data : shape[k].parse(undefined)) as z.output<(typeof shape)[K]>;
  };
  const input = { range: field("range"), from: field("from"), to: field("to"), brandId: field("brandId"), departmentId: field("departmentId"), jobId: field("jobId") };
  const tz = actor.timezone || "America/Toronto";
  const today = ymd(new TZDate(now.getTime(), tz));

  let fromDay: string;
  let toDay = today;
  if (input.range === "custom" && input.from && input.to) {
    [fromDay, toDay] = input.from <= input.to ? [input.from, input.to] : [input.to, input.from];
  } else if (input.range === "ytd") {
    fromDay = `${today.slice(0, 4)}-01-01`;
  } else {
    const days = input.range === "custom" ? 90 : Number(input.range.replace("d", ""));
    const start = startOfDay(today, tz);
    start.setDate(start.getDate() - (days - 1));
    fromDay = ymd(start);
  }
  const end = startOfDay(toDay, tz);
  end.setDate(end.getDate() + 1);

  return {
    range: input.range === "custom" && !(input.from && input.to) ? "90d" : input.range,
    fromDay,
    toDay,
    from: new Date(startOfDay(fromDay, tz).getTime()),
    toExclusive: new Date(end.getTime()),
    brandId: input.brandId,
    departmentId: input.departmentId,
    jobId: input.jobId,
    tz,
  };
}

/** Back to search params, e.g. for drill-down links and exports. */
export function filtersToParams(f: ReportFilters): Record<string, string> {
  const p: Record<string, string> = { range: f.range };
  if (f.range === "custom") Object.assign(p, { from: f.fromDay, to: f.toDay });
  if (f.brandId) p.brandId = f.brandId;
  if (f.departmentId) p.departmentId = f.departmentId;
  if (f.jobId) p.jobId = f.jobId;
  return p;
}

/**
 * Ids of the jobs in scope: what the actor may see (ARCHITECTURE.md §3.4), narrowed by the
 * brand/department/job filters. Every report query restricts itself to `job_id IN (scope)`.
 */
export function jobScope(actor: UserActor, f: Pick<ReportFilters, "brandId" | "departmentId" | "jobId">): SQL {
  const conds: SQL[] = [sql`sj.id IN (${visibleJobIds(actor)})`];
  if (f.brandId) conds.push(sql`sj.brand_id = ${f.brandId}`);
  if (f.departmentId) conds.push(sql`sj.department_id = ${f.departmentId}`);
  if (f.jobId) conds.push(sql`sj.id = ${f.jobId}`);
  return sql`SELECT sj.id FROM jobs sj WHERE ${sql.join(conds, sql` AND `)}`;
}

/** `col >= from AND col < to` for the report window. */
export function inWindow(col: SQL, f: Pick<ReportFilters, "from" | "toExclusive">): SQL {
  return sql`${col} >= ${f.from.toISOString()}::timestamptz AND ${col} < ${f.toExclusive.toISOString()}::timestamptz`;
}
