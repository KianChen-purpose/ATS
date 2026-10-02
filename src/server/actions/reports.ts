"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { dimensionValues, InvalidDefinitionError } from "@/server/services/reports/builder";
import { resolveFilters } from "@/server/services/reports/filters";
import * as feed from "@/server/services/reports/feed";
import * as saved from "@/server/services/reports/saved";
import * as schedules from "@/server/services/reports/schedules";

const id = z.uuid();

/** Expected failures come back as a message; anything else is a real error. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError) return { error: e.issues[0]?.message ?? "Check the details." };
    if (e instanceof ForbiddenError || e instanceof NotFoundError || e instanceof InvalidDefinitionError) return { error: e.message };
    throw e;
  }
}

export async function saveReportAction(input: z.input<typeof saved.savedReportSchema>) {
  const actor = await requireActor();
  return attempt(async () => {
    const r = await saved.saveReport(actor, input);
    revalidatePath("/reports/saved");
    revalidatePath(`/reports/saved/${r.id}`);
    return r;
  });
}

export async function deleteReportAction(reportId: string) {
  const actor = await requireActor();
  return attempt(async () => {
    await saved.deleteSavedReport(actor, id.parse(reportId));
    revalidatePath("/reports/saved");
    return { ok: true as const };
  });
}

export async function saveDashboardAction(input: z.input<typeof saved.dashboardSchema>) {
  const actor = await requireActor();
  return attempt(async () => {
    const r = await saved.saveDashboard(actor, input);
    revalidatePath("/reports/saved");
    revalidatePath(`/reports/dashboards/${r.id}`);
    return r;
  });
}

export async function addToDashboardAction(dashboardId: string, reportId: string) {
  const actor = await requireActor();
  return attempt(async () => {
    const r = await saved.addToDashboard(actor, id.parse(dashboardId), id.parse(reportId));
    revalidatePath(`/reports/dashboards/${r.id}`);
    return r;
  });
}

export async function deleteDashboardAction(dashboardId: string) {
  const actor = await requireActor();
  return attempt(async () => {
    await saved.deleteDashboard(actor, id.parse(dashboardId));
    revalidatePath("/reports/saved");
    return { ok: true as const };
  });
}

/** Values for the builder's filter picker, within the same scope the report runs in. */
export async function builderDimensionValues(definition: unknown, dimension: string, params: Record<string, string>) {
  const actor = await requireActor();
  const p = z.record(z.string().max(40), z.string().max(100)).parse(params);
  return attempt(() => dimensionValues(actor, definition, z.string().max(40).parse(dimension), resolveFilters(actor, p)));
}

export async function createFeedTokenAction(input: { name: string; days: number }) {
  const actor = await requireActor();
  return attempt(async () => {
    const r = await feed.createFeedToken(actor, input);
    revalidatePath("/reports/powerbi");
    return { token: r.token };
  });
}

export async function revokeFeedTokenAction(tokenId: string) {
  const actor = await requireActor();
  return attempt(async () => {
    await feed.revokeFeedToken(actor, id.parse(tokenId));
    revalidatePath("/reports/powerbi");
    return { ok: true as const };
  });
}

export async function createScheduleAction(input: schedules.ScheduleInput) {
  const actor = await requireActor();
  return attempt(async () => {
    const r = await schedules.createSchedule(actor, input);
    revalidatePath(`/reports/saved/${r.reportId}`);
    return { id: r.id };
  });
}

export async function updateScheduleAction(scheduleId: string, reportId: string, op: "pause" | "resume" | "delete" | "send") {
  const actor = await requireActor();
  return attempt(async () => {
    const sid = id.parse(scheduleId);
    const o = z.enum(["pause", "resume", "delete", "send"]).parse(op);
    if (o === "delete") await schedules.deleteSchedule(actor, sid);
    else if (o === "send") await schedules.requestScheduleRun(actor, sid);
    else await schedules.setScheduleActive(actor, sid, o === "resume");
    revalidatePath(`/reports/saved/${id.parse(reportId)}`);
    return { ok: true as const };
  });
}
