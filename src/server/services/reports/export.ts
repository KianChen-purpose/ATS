import "server-only";
import { db } from "@/db";
import type { Actor, UserActor } from "@/server/policy";
import { recordAudit } from "../audit";
import { reportRecords, runReport, validateDefinition, NONE, type ReportResult } from "./builder";
import { datasetByKey, type Format } from "./datasets";
import { drillDown, describeDrill, type DrillSet } from "./drilldown";
import { filtersToParams, type ReportFilters } from "./filters";
import { EXPORT_TYPES, renderTable, type Cell, type CellFormat, type ExportFormat, type Table } from "./spreadsheet";

/**
 * Report exports (PRD §7.3): CSV and Excel. Every export is audited (ARCHITECTURE.md §4.2) with what
 * was exported, the filters, the row count and, for record lists, the application ids, so a privacy
 * request can tell who exported whose data.
 */

export type ExportFile = { fileName: string; contentType: string; bytes: Buffer; rows: number };

const CELL: Record<Format, CellFormat> = { count: "int", percent: "percent", days: "decimal", hours: "decimal", money: "money" };

function slug(s: string) {
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase()
      .slice(0, 60) || "report"
  );
}

function fileName(name: string, f: ReportFilters, format: ExportFormat) {
  return `${slug(name)}_${f.fromDay}_${f.toDay}.${EXPORT_TYPES[format].ext}`;
}

/** The aggregate table of a builder result, with a total row when it's grouped. */
export function resultTable(result: ReportResult, title: string): Table {
  const dims = result.columns.filter((c) => c.kind === "dimension");
  const metrics = result.columns.filter((c) => c.kind === "metric");
  const rows: Cell[][] = result.rows.map((r) => [...r.keys.map((k) => k ?? "(none)"), ...r.values.map((v, i) => ({ value: v, format: CELL[metrics[i].format ?? "count"] }))]);
  if (dims.length) rows.push([...dims.map((_, i) => (i === 0 ? "Total" : "")), ...result.totals.map((v, i) => ({ value: v, format: CELL[metrics[i].format ?? "count"] }))]);
  return { name: result.dataset.label, title, headers: [...dims.map((d) => d.label), ...metrics.map((m) => m.label)], rows };
}

function describeFilters(f: ReportFilters) {
  return `${f.fromDay} to ${f.toDay}`;
}

async function audit(actor: Actor, entityId: string | null, metadata: Record<string, unknown>) {
  await db.transaction((tx) => recordAudit(tx, actor, "report.exported", entityId ? "saved_report" : "report", entityId, metadata));
}

export async function exportBuilderReport(actor: UserActor, input: unknown, f: ReportFilters, format: ExportFormat, opts: { name?: string; savedReportId?: string } = {}): Promise<ExportFile> {
  const def = validateDefinition(input);
  const result = await runReport(actor, def, f);
  const name = opts.name ?? `${result.dataset.label} report`;
  const bytes = renderTable(resultTable(result, `${name} · ${describeFilters(f)}`), format);
  await audit(actor, opts.savedReportId ?? null, { kind: "aggregate", dataset: def.dataset, groupBy: def.groupBy, metrics: def.metrics, format, rows: result.rows.length, filters: filtersToParams(f) });
  return { fileName: fileName(name, f, format), contentType: EXPORT_TYPES[format].contentType, bytes, rows: result.rows.length };
}

/** The records behind a builder row. Contains names, so it's a personal-data export. */
export async function exportBuilderRecords(actor: UserActor, input: unknown, f: ReportFilters, keys: string[], format: ExportFormat): Promise<ExportFile> {
  const def = validateDefinition(input);
  const data = await reportRecords(actor, def, f, keys);
  const ds = datasetByKey(def.dataset)!;
  const scope = keys.map((k, i) => `${ds.dimensions.find((d) => d.key === def.groupBy[i])?.label}: ${k === NONE ? "(none)" : k}`).join(", ");
  const table: Table = {
    tz: f.tz,
    name: ds.label,
    title: `${ds.label}${scope ? ` · ${scope}` : ""} · ${describeFilters(f)}`,
    headers: [data.candidate ? "Candidate" : "Opening", "Job", ...data.columns.map((c) => c.label)],
    rows: data.rows.map((r) => [
      r.candidate,
      r.job,
      ...data.columns.map((c): Cell => {
        const v = r[c.key];
        if (v == null) return null;
        if (c.format === "date") return new Date(v as string);
        if (c.format === "money") return { value: Number(v), format: "money" };
        return String(v);
      }),
    ]),
  };
  await audit(actor, null, {
    kind: "records",
    dataset: def.dataset,
    keys,
    format,
    rows: data.rows.length,
    filters: filtersToParams(f),
    applicationIds: data.rows.map((r) => r.application_id).filter(Boolean),
  });
  return { fileName: fileName(`${ds.label}-records`, f, format), contentType: EXPORT_TYPES[format].contentType, bytes: renderTable(table, format), rows: data.rows.length };
}

/** The applications behind a standard-report number. */
export async function exportDrillRecords(actor: UserActor, f: ReportFilters, set: DrillSet, format: ExportFormat): Promise<ExportFile> {
  const { rows } = await drillDown(actor, f, set);
  const title = describeDrill(set, set.set === "source" ? (rows[0]?.source ?? undefined) : undefined);
  const table: Table = {
    tz: f.tz,
    name: "Applications",
    title: `${title} · ${describeFilters(f)}`,
    headers: ["Candidate", "Job", "Brand", "Stage", "Status", "Source", "Applied", "Hired"],
    rows: rows.map((r) => [`${r.first_name} ${r.last_name}`, r.job_title, r.brand, r.stage, r.status, r.source, new Date(r.applied_at), r.hired_at ? new Date(r.hired_at) : null]),
  };
  await audit(actor, null, { kind: "records", drill: set, format, rows: rows.length, filters: filtersToParams(f), applicationIds: rows.map((r) => r.application_id) });
  return { fileName: fileName(title, f, format), contentType: EXPORT_TYPES[format].contentType, bytes: renderTable(table, format), rows: rows.length };
}
