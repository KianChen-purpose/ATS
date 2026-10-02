import "server-only";
import { z } from "zod";
import { sql, type SQL } from "drizzle-orm";
import { reportingDb } from "@/db/reporting";
import { canViewCompensation, canViewTeamAnalytics, ForbiddenError, type UserActor } from "@/server/policy";
import { inWindow, jobScope, type ReportFilters } from "./filters";
import { DATASETS, datasetByKey, type Dataset, type Dimension, type Format, type Metric, type RecordColumn } from "./datasets";
import { assertCanViewReports } from "./standard";

/**
 * Custom report builder (PRD §7.2): pick a dataset, up to two group-bys, metrics, filters and a
 * visualization. A definition is plain data validated against the catalogue in datasets.ts; the SQL
 * is assembled here from whitelisted fragments and always restricted to the viewer's visible jobs.
 */

export const VISUALIZATIONS = ["table", "bar", "line", "pivot"] as const;
export const MAX_GROUPS = 500;
export const MAX_PIVOT_COLUMNS = 24;
export const RECORD_LIMIT = 500;
/** Marker for "no value" in filters and drill-down keys. */
export const NONE = "∅";

export const definitionSchema = z.object({
  dataset: z.string().min(1).max(40),
  dateField: z.string().min(1).max(40),
  groupBy: z.array(z.string().min(1).max(40)).max(2).default([]),
  metrics: z.array(z.string().min(1).max(40)).min(1).max(4),
  filters: z.array(z.object({ dimension: z.string().min(1).max(40), values: z.array(z.string().max(300)).min(1).max(50) })).max(6).default([]),
  visualization: z.enum(VISUALIZATIONS).default("table"),
});
export type ReportDefinition = z.output<typeof definitionSchema>;
export type ReportDefinitionInput = z.input<typeof definitionSchema>;

export class InvalidDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDefinitionError";
  }
}

export const DEFAULT_DEFINITION: ReportDefinition = {
  dataset: "applications",
  dateField: "applied_at",
  groupBy: ["source_category"],
  metrics: ["count", "hired", "hire_rate"],
  filters: [],
  visualization: "bar",
};

/** Checks every key against the catalogue and normalises the visualization. */
export function validateDefinition(input: unknown): ReportDefinition {
  const parsed = definitionSchema.safeParse(input);
  if (!parsed.success) throw new InvalidDefinitionError("The report definition is incomplete.");
  const def = parsed.data;
  const ds = datasetByKey(def.dataset);
  if (!ds) throw new InvalidDefinitionError(`Unknown dataset "${def.dataset}".`);
  if (!ds.dateFields.some((d) => d.key === def.dateField)) throw new InvalidDefinitionError(`"${def.dateField}" isn't a date on ${ds.label}.`);
  const dims = new Set(ds.dimensions.map((d) => d.key));
  for (const g of def.groupBy) if (!dims.has(g)) throw new InvalidDefinitionError(`"${g}" isn't a dimension of ${ds.label}.`);
  if (new Set(def.groupBy).size !== def.groupBy.length) throw new InvalidDefinitionError("Group by two different dimensions.");
  const metrics = new Set(ds.metrics.map((m) => m.key));
  for (const m of def.metrics) if (!metrics.has(m)) throw new InvalidDefinitionError(`"${m}" isn't a metric of ${ds.label}.`);
  for (const f of def.filters) if (!dims.has(f.dimension)) throw new InvalidDefinitionError(`"${f.dimension}" isn't a dimension of ${ds.label}.`);

  const firstDim = ds.dimensions.find((d) => d.key === def.groupBy[0]);
  let visualization = def.visualization;
  if (visualization === "pivot" && def.groupBy.length < 2) visualization = "table";
  // A line is one series over time: exactly one group-by, and it must be a time bucket.
  if (visualization === "line" && (!firstDim?.time || def.groupBy.length !== 1)) visualization = def.groupBy.length ? "bar" : "table";
  if (visualization === "bar" && def.groupBy.length === 0) visualization = "table";
  return { ...def, metrics: [...new Set(def.metrics)], visualization };
}

/** URL-safe encoding, so a builder state is a shareable link. */
export function encodeDefinition(def: ReportDefinitionInput) {
  return Buffer.from(JSON.stringify(def), "utf8").toString("base64url");
}
export function decodeDefinition(q: string | undefined | null): ReportDefinition {
  if (!q) return DEFAULT_DEFINITION;
  try {
    return validateDefinition(JSON.parse(Buffer.from(q, "base64url").toString("utf8")));
  } catch {
    return DEFAULT_DEFINITION;
  }
}

/** Person dimensions and the per-person dataset follow the team-analytics rule. */
export function assertCanRun(actor: UserActor, def: ReportDefinition) {
  assertCanViewReports(actor);
  const ds = datasetByKey(def.dataset)!;
  const keys = [...def.groupBy, ...def.filters.map((f) => f.dimension)];
  const person = ds.person || ds.dimensions.some((d) => d.person && keys.includes(d.key));
  if (person && !canViewTeamAnalytics(actor)) throw new ForbiddenError("This report breaks numbers down by person, which your role can't see.");
}

type Ctx = { ds: Dataset; dims: Dimension[]; dateCol: SQL; tz: string };

function context(def: ReportDefinition, f: ReportFilters): Ctx {
  const ds = datasetByKey(def.dataset)!;
  return {
    ds,
    dims: def.groupBy.map((k) => ds.dimensions.find((d) => d.key === k)!),
    dateCol: ds.dateFields.find((d) => d.key === def.dateField)!.col,
    tz: f.tz,
  };
}

function whereClause(actor: UserActor, def: ReportDefinition, f: ReportFilters, ctx: Ctx, extra: SQL[] = []) {
  const conds: SQL[] = [sql`j.id IN (${jobScope(actor, f)})`, inWindow(ctx.dateCol, f)];
  for (const flt of def.filters) {
    const dim = ctx.ds.dimensions.find((d) => d.key === flt.dimension)!;
    const expr = sql`(${dim.expr(ctx.tz, ctx.dateCol)})::text`;
    const values = flt.values.filter((v) => v !== NONE);
    const parts: SQL[] = [];
    if (values.length) parts.push(sql`${expr} IN (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`);
    if (flt.values.includes(NONE)) parts.push(sql`${expr} IS NULL`);
    conds.push(sql`(${sql.join(parts, sql` OR `)})`);
  }
  return sql.join([...conds, ...extra], sql` AND `);
}

export type ResultColumn = { key: string; label: string; kind: "dimension" | "metric"; format?: Format; time?: boolean; description?: string };
export type ResultRow = { keys: (string | null)[]; values: (number | null)[] };
export type ReportResult = {
  definition: ReportDefinition;
  dataset: { key: string; label: string; noun: string };
  columns: ResultColumn[];
  rows: ResultRow[];
  totals: (number | null)[];
  truncated: boolean;
  /** Metrics dropped because the viewer can't see compensation. */
  hiddenMetrics: string[];
};

function visibleMetrics(actor: UserActor, ds: Dataset, def: ReportDefinition) {
  const all = def.metrics.map((k) => ds.metrics.find((m) => m.key === k)!);
  const allowed = canViewCompensation(actor);
  return { metrics: all.filter((m) => allowed || !m.compensation), hidden: all.filter((m) => !allowed && m.compensation).map((m) => m.label) };
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function runReport(actor: UserActor, input: unknown, f: ReportFilters): Promise<ReportResult> {
  const def = validateDefinition(input);
  assertCanRun(actor, def);
  const ctx = context(def, f);
  const { metrics, hidden } = visibleMetrics(actor, ctx.ds, def);
  const where = whereClause(actor, def, f, ctx);
  const dimSel = ctx.dims.map((d, i) => sql`(${d.expr(ctx.tz, ctx.dateCol)})::text AS ${sql.raw(`d${i}`)}`);
  const metricSel = (ms: Metric[]) => (ms.length ? ms.map((m, i) => sql`${m.expr} AS ${sql.raw(`m${i}`)}`) : [sql`count(*)::int AS m0`]);
  const order: SQL[] = ctx.dims.map((d, i) =>
    d.time ? sql.raw(`d${i} ASC NULLS LAST`) : d.order ? sql`min(${d.order(ctx.tz, ctx.dateCol)}) ASC NULLS LAST` : sql.raw(i === 0 && metrics.length ? `m0 DESC NULLS LAST, d${i} ASC` : `d${i} ASC`),
  );

  const groupBy = ctx.dims.length ? sql` GROUP BY ${sql.join(ctx.dims.map((_, i) => sql.raw(`d${i}`)), sql`, `)}` : sql``;
  const orderBy = order.length ? sql` ORDER BY ${sql.join(order, sql`, `)}` : sql``;
  const query = sql`SELECT ${sql.join([...dimSel, ...metricSel(metrics)], sql`, `)} FROM ${ctx.ds.from} WHERE ${where}${groupBy}${orderBy} LIMIT ${MAX_GROUPS + 1}`;
  const totalsQuery = sql`SELECT ${sql.join(metricSel(metrics), sql`, `)} FROM ${ctx.ds.from} WHERE ${where}`;
  const [res, tot] = await Promise.all([reportingDb.execute(query), reportingDb.execute(totalsQuery)]);
  const raw = res.rows as Record<string, unknown>[];
  const rows = raw.slice(0, MAX_GROUPS).map((r) => ({
    keys: ctx.dims.map((_, i) => (r[`d${i}`] as string | null) ?? null),
    values: metrics.map((_, i) => num(r[`m${i}`])),
  }));
  const totalRow = (tot.rows[0] ?? {}) as Record<string, unknown>;
  const filled = ctx.dims.length === 1 && ctx.dims[0].time ? await fillTimeBuckets(ctx.dims[0].key, f, rows, metrics) : rows;
  return {
    definition: def,
    dataset: { key: ctx.ds.key, label: ctx.ds.label, noun: ctx.ds.noun },
    columns: [
      ...ctx.dims.map((d) => ({ key: d.key, label: d.label, kind: "dimension" as const, time: d.time })),
      ...metrics.map((m) => ({ key: m.key, label: m.label, kind: "metric" as const, format: m.format, description: m.description })),
    ],
    rows: filled,
    totals: metrics.map((_, i) => num(totalRow[`m${i}`])),
    truncated: raw.length > MAX_GROUPS,
    hiddenMetrics: hidden,
  };
}

const BUCKETS: Record<string, { trunc: string; step: string; format: string }> = {
  week: { trunc: "week", step: "1 week", format: "YYYY-MM-DD" },
  month: { trunc: "month", step: "1 month", format: "YYYY-MM" },
  quarter: { trunc: "quarter", step: "3 months", format: 'YYYY-"Q"Q' },
};

/** A time series has a row for every bucket in the window: counts are 0, other metrics empty. */
async function fillTimeBuckets(key: string, f: ReportFilters, rows: ResultRow[], metrics: Metric[]) {
  const b = BUCKETS[key];
  if (!b) return rows;
  const res = await reportingDb.execute(sql`
    SELECT to_char(g, ${b.format}) AS k FROM generate_series(
      date_trunc(${b.trunc}, ${f.from.toISOString()}::timestamptz AT TIME ZONE ${f.tz}),
      date_trunc(${b.trunc}, (${f.toExclusive.toISOString()}::timestamptz - interval '1 second') AT TIME ZONE ${f.tz}),
      ${b.step}::interval) AS g`);
  const byKey = new Map(rows.map((r) => [r.keys[0], r]));
  const all = (res.rows as { k: string }[]).map((r) => byKey.get(r.k) ?? { keys: [r.k], values: metrics.map((m) => (m.format === "count" ? 0 : null)) });
  const extra = rows.filter((r) => !all.includes(r));
  return [...all, ...extra];
}

/** Distinct values of a dimension, for the filter picker. Same scope as the report. */
export async function dimensionValues(actor: UserActor, input: unknown, dimension: string, f: ReportFilters) {
  const def = validateDefinition(input);
  const ds = datasetByKey(def.dataset)!;
  const dim = ds.dimensions.find((d) => d.key === dimension);
  if (!dim) throw new InvalidDefinitionError(`"${dimension}" isn't a dimension of ${ds.label}.`);
  assertCanRun(actor, { ...def, groupBy: [dimension], filters: [] });
  const ctx = context({ ...def, groupBy: [] }, f);
  const where = whereClause(actor, { ...def, filters: [] }, f, ctx);
  const res = await reportingDb.execute(
    sql`SELECT DISTINCT (${dim.expr(ctx.tz, ctx.dateCol)})::text AS v FROM ${ds.from} WHERE ${where} ORDER BY v NULLS LAST LIMIT 200`,
  );
  return (res.rows as { v: string | null }[]).map((r) => r.v ?? NONE);
}

export type RecordRow = { candidate_id: string | null; application_id: string | null; candidate: string; job_id: string; job: string; [k: string]: unknown };

/**
 * The records behind one row of a report (drill-down). `keys` are that row's dimension values, in
 * group-by order; NONE matches an empty value.
 */
export async function reportRecords(actor: UserActor, input: unknown, f: ReportFilters, keys: string[]) {
  const def = validateDefinition(input);
  assertCanRun(actor, def);
  const ctx = context(def, f);
  const extra = ctx.dims.slice(0, keys.length).map((d, i) => {
    const expr = sql`(${d.expr(ctx.tz, ctx.dateCol)})::text`;
    return keys[i] === NONE ? sql`${expr} IS NULL` : sql`${expr} = ${keys[i]}`;
  });
  const where = whereClause(actor, def, f, ctx, extra);
  const res = await reportingDb.execute(sql`SELECT ${ctx.ds.records.select} FROM ${ctx.ds.from} WHERE ${where} ORDER BY ${ctx.ds.records.orderBy} LIMIT ${RECORD_LIMIT + 1}`);
  const comp = canViewCompensation(actor);
  const columns: RecordColumn[] = ctx.ds.records.columns.filter((c) => comp || c.format !== "money");
  const rows = (res.rows as RecordRow[]).slice(0, RECORD_LIMIT).map((r) => {
    if (comp) return r;
    const out = { ...r };
    for (const c of ctx.ds.records.columns) if (c.format === "money") delete out[c.key];
    return out;
  });
  return { rows, columns, truncated: res.rows.length > RECORD_LIMIT, candidate: ctx.ds.records.candidate, dataset: ctx.ds.label };
}

/** What the builder UI may offer this viewer. Person dimensions and compensation metrics are left out when not allowed. */
export function builderCatalogue(actor: UserActor) {
  const team = canViewTeamAnalytics(actor);
  const comp = canViewCompensation(actor);
  return DATASETS.filter((d) => team || !d.person).map((d) => ({
    key: d.key,
    label: d.label,
    description: d.description,
    dateFields: d.dateFields.map(({ key, label }) => ({ key, label })),
    dimensions: d.dimensions.filter((x) => team || !x.person).map(({ key, label, time }) => ({ key, label, time: !!time })),
    metrics: d.metrics.filter((m) => comp || !m.compensation).map(({ key, label, format, description }) => ({ key, label, format, description })),
  }));
}
export type BuilderCatalogue = ReturnType<typeof builderCatalogue>;
