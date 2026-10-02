import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { canViewReports, ForbiddenError, NotFoundError, type Role, type UserActor } from "@/server/policy";
import { recordAudit } from "../audit";
import type { Tx } from "../tx";
import { assertCanRun, validateDefinition, type ReportDefinition } from "./builder";
import { reportFiltersSchema } from "./filters";
import { assertCanViewReports } from "./standard";

/**
 * Saved reports and dashboards (PRD §7.2). Sharing shares the definition, never the numbers: each
 * viewer runs a shared report under their own access, so a hiring manager opening a recruiter's
 * report sees only their own jobs. Changes are audited like any other setting.
 */

export const VISIBILITY = ["private", "people", "everyone"] as const;

const shareFields = {
  visibility: z.enum(VISIBILITY).default("private"),
  shareWith: z.array(z.uuid()).max(100).default([]),
};

export const savedReportSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  definition: z.unknown(),
  filters: reportFiltersSchema.partial().default({}),
  ...shareFields,
});

export const dashboardSchema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  reportIds: z.array(z.uuid()).max(24).default([]),
  ...shareFields,
});

type Owned = { ownerId: string; visibility: (typeof VISIBILITY)[number] };

function canOpen(actor: UserActor, item: Owned, sharedWith: string[]) {
  if (item.ownerId === actor.id || actor.role === "admin") return true;
  if (item.visibility === "everyone") return true;
  return item.visibility === "people" && sharedWith.includes(actor.id);
}

function assertCanEdit(actor: UserActor, item: { ownerId: string }) {
  if (item.ownerId !== actor.id && actor.role !== "admin") throw new ForbiddenError("Only the owner can change this.");
}

/** Share targets must be active staff who can open reports. */
async function validShareTargets(tx: Tx, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const users = await tx.select({ id: s.users.id, role: s.users.role, active: s.users.active }).from(s.users).where(inArray(s.users.id, unique));
  const ok = users.filter((u) => u.active && canViewReports({ role: u.role as Role } as UserActor));
  if (ok.length !== unique.length) throw new ForbiddenError("Reports can only be shared with people who can open reports.");
  return unique;
}

/** Report filters stored with a saved report: only the keys the filter row understands. */
function cleanFilters(f: z.output<typeof savedReportSchema>["filters"]) {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Saved reports
// ---------------------------------------------------------------------------

export async function saveReport(actor: UserActor, input: z.input<typeof savedReportSchema>) {
  assertCanViewReports(actor);
  const d = savedReportSchema.parse(input);
  const definition: ReportDefinition = validateDefinition(d.definition);
  // You can only save what you can run yourself.
  assertCanRun(actor, definition);
  return db.transaction(async (tx) => {
    const shareWith = d.visibility === "people" ? await validShareTargets(tx, d.shareWith) : [];
    const values = { name: d.name, description: d.description, definition, filters: cleanFilters(d.filters), visibility: d.visibility, updatedAt: new Date() };
    let id = d.id;
    if (id) {
      const existing = await tx.query.savedReports.findFirst({ where: eq(s.savedReports.id, id) });
      if (!existing) throw new NotFoundError("Report");
      assertCanEdit(actor, existing);
      await tx.update(s.savedReports).set(values).where(eq(s.savedReports.id, id));
      await tx.delete(s.savedReportShares).where(eq(s.savedReportShares.reportId, id));
      await recordAudit(tx, actor, "saved_report.updated", "saved_report", id, { name: d.name, visibility: d.visibility, sharedWith: shareWith.length });
    } else {
      const [row] = await tx.insert(s.savedReports).values({ ...values, ownerId: actor.id }).returning({ id: s.savedReports.id });
      id = row.id;
      await recordAudit(tx, actor, "saved_report.created", "saved_report", id, { name: d.name, visibility: d.visibility, sharedWith: shareWith.length, dataset: definition.dataset });
    }
    if (shareWith.length) await tx.insert(s.savedReportShares).values(shareWith.map((userId) => ({ reportId: id!, userId })));
    return { id: id! };
  });
}

export async function deleteSavedReport(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  return db.transaction(async (tx) => {
    const existing = await tx.query.savedReports.findFirst({ where: eq(s.savedReports.id, id) });
    if (!existing) throw new NotFoundError("Report");
    assertCanEdit(actor, existing);
    await tx.delete(s.reportDashboardItems).where(eq(s.reportDashboardItems.reportId, id));
    await tx.delete(s.savedReportShares).where(eq(s.savedReportShares.reportId, id));
    await tx.delete(s.savedReports).where(eq(s.savedReports.id, id));
    await recordAudit(tx, actor, "saved_report.deleted", "saved_report", id, { name: existing.name });
  });
}

/** Saved reports this viewer may open. */
export async function listSavedReports(actor: UserActor) {
  assertCanViewReports(actor);
  const where =
    actor.role === "admin"
      ? undefined
      : or(
          eq(s.savedReports.ownerId, actor.id),
          eq(s.savedReports.visibility, "everyone"),
          and(eq(s.savedReports.visibility, "people"), sql`EXISTS (SELECT 1 FROM saved_report_shares sh WHERE sh.report_id = ${s.savedReports.id} AND sh.user_id = ${actor.id})`),
        );
  const rows = await db.query.savedReports.findMany({ where, orderBy: desc(s.savedReports.updatedAt), with: { owner: true } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    dataset: (r.definition as { dataset?: string }).dataset ?? "",
    visibility: r.visibility,
    owner: r.owner.name,
    mine: r.ownerId === actor.id,
    updatedAt: r.updatedAt,
  }));
}

export async function getSavedReport(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  const r = await db.query.savedReports.findFirst({ where: eq(s.savedReports.id, id), with: { owner: true, shares: { with: { user: true } } } });
  if (!r || !canOpen(actor, r, r.shares.map((x) => x.userId))) throw new NotFoundError("Report");
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    definition: r.definition,
    filters: r.filters,
    visibility: r.visibility,
    owner: { id: r.ownerId, name: r.owner.name },
    sharedWith: r.shares.map((x) => ({ id: x.userId, name: x.user.name })),
    canEdit: r.ownerId === actor.id || actor.role === "admin",
    updatedAt: r.updatedAt,
  };
}

/** People a report can be shared with (anyone who can open reports). */
export async function shareablePeople(actor: UserActor) {
  assertCanViewReports(actor);
  const rows = await db
    .select({ id: s.users.id, name: s.users.name, role: s.users.role })
    .from(s.users)
    .where(and(eq(s.users.active, true), sql`${s.users.role} <> 'interviewer'`, sql`${s.users.id} <> ${actor.id}`))
    .orderBy(asc(s.users.name));
  return rows;
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export async function saveDashboard(actor: UserActor, input: z.input<typeof dashboardSchema>) {
  assertCanViewReports(actor);
  const d = dashboardSchema.parse(input);
  return db.transaction(async (tx) => {
    const shareWith = d.visibility === "people" ? await validShareTargets(tx, d.shareWith) : [];
    // Tiles must be reports the editor can open.
    const reportIds = [...new Set(d.reportIds)];
    if (reportIds.length) {
      const reports = await tx.query.savedReports.findMany({ where: inArray(s.savedReports.id, reportIds), with: { shares: true } });
      if (reports.length !== reportIds.length || reports.some((r) => !canOpen(actor, r, r.shares.map((x) => x.userId)))) throw new NotFoundError("Report");
    }
    const values = { name: d.name, description: d.description, visibility: d.visibility, updatedAt: new Date() };
    let id = d.id;
    if (id) {
      const existing = await tx.query.reportDashboards.findFirst({ where: eq(s.reportDashboards.id, id) });
      if (!existing) throw new NotFoundError("Dashboard");
      assertCanEdit(actor, existing);
      await tx.update(s.reportDashboards).set(values).where(eq(s.reportDashboards.id, id));
      await tx.delete(s.reportDashboardShares).where(eq(s.reportDashboardShares.dashboardId, id));
      await tx.delete(s.reportDashboardItems).where(eq(s.reportDashboardItems.dashboardId, id));
      await recordAudit(tx, actor, "report_dashboard.updated", "report_dashboard", id, { name: d.name, visibility: d.visibility, tiles: reportIds.length });
    } else {
      const [row] = await tx.insert(s.reportDashboards).values({ ...values, ownerId: actor.id }).returning({ id: s.reportDashboards.id });
      id = row.id;
      await recordAudit(tx, actor, "report_dashboard.created", "report_dashboard", id, { name: d.name, visibility: d.visibility, tiles: reportIds.length });
    }
    if (shareWith.length) await tx.insert(s.reportDashboardShares).values(shareWith.map((userId) => ({ dashboardId: id!, userId })));
    if (reportIds.length) await tx.insert(s.reportDashboardItems).values(reportIds.map((reportId, position) => ({ dashboardId: id!, reportId, position })));
    return { id: id! };
  });
}

/** Adds a report to the end of a dashboard the actor owns. */
export async function addToDashboard(actor: UserActor, dashboardId: string, reportId: string) {
  const dash = await getDashboard(actor, dashboardId);
  if (!dash.canEdit) throw new ForbiddenError("Only the owner can change this.");
  const ids = dash.items.map((i) => i.reportId);
  if (ids.includes(reportId)) return { id: dashboardId };
  return saveDashboard(actor, { id: dashboardId, name: dash.name, description: dash.description ?? undefined, visibility: dash.visibility, shareWith: dash.sharedWith.map((u) => u.id), reportIds: [...ids, reportId] });
}

export async function deleteDashboard(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  return db.transaction(async (tx) => {
    const existing = await tx.query.reportDashboards.findFirst({ where: eq(s.reportDashboards.id, id) });
    if (!existing) throw new NotFoundError("Dashboard");
    assertCanEdit(actor, existing);
    await tx.delete(s.reportDashboardItems).where(eq(s.reportDashboardItems.dashboardId, id));
    await tx.delete(s.reportDashboardShares).where(eq(s.reportDashboardShares.dashboardId, id));
    await tx.delete(s.reportDashboards).where(eq(s.reportDashboards.id, id));
    await recordAudit(tx, actor, "report_dashboard.deleted", "report_dashboard", id, { name: existing.name });
  });
}

export async function listDashboards(actor: UserActor) {
  assertCanViewReports(actor);
  const where =
    actor.role === "admin"
      ? undefined
      : or(
          eq(s.reportDashboards.ownerId, actor.id),
          eq(s.reportDashboards.visibility, "everyone"),
          and(eq(s.reportDashboards.visibility, "people"), sql`EXISTS (SELECT 1 FROM report_dashboard_shares sh WHERE sh.dashboard_id = ${s.reportDashboards.id} AND sh.user_id = ${actor.id})`),
        );
  const rows = await db.query.reportDashboards.findMany({ where, orderBy: desc(s.reportDashboards.updatedAt), with: { owner: true, items: true } });
  return rows.map((r) => ({ id: r.id, name: r.name, description: r.description, visibility: r.visibility, owner: r.owner.name, mine: r.ownerId === actor.id, tiles: r.items.length, updatedAt: r.updatedAt }));
}

/** A dashboard and its tiles. Tiles the viewer can't open are counted, not shown. */
export async function getDashboard(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  const d = await db.query.reportDashboards.findFirst({
    where: eq(s.reportDashboards.id, id),
    with: { owner: true, shares: { with: { user: true } }, items: { orderBy: asc(s.reportDashboardItems.position), with: { report: { with: { shares: true } } } } },
  });
  if (!d || !canOpen(actor, d, d.shares.map((x) => x.userId))) throw new NotFoundError("Dashboard");
  const items = d.items.filter((i) => canOpen(actor, i.report, i.report.shares.map((x) => x.userId)));
  return {
    id: d.id,
    name: d.name,
    description: d.description,
    visibility: d.visibility,
    owner: { id: d.ownerId, name: d.owner.name },
    sharedWith: d.shares.map((x) => ({ id: x.userId, name: x.user.name })),
    canEdit: d.ownerId === actor.id || actor.role === "admin",
    items: items.map((i) => ({ reportId: i.reportId, name: i.report.name, definition: i.report.definition, filters: i.report.filters })),
    hiddenTiles: d.items.length - items.length,
  };
}
