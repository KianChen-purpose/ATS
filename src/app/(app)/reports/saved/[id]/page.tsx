import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil } from "lucide-react";
import { requireActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { encodeDefinition, runReport, validateDefinition, type ReportResult } from "@/server/services/reports/builder";
import { filtersToParams } from "@/server/services/reports/filters";
import { getSavedReport, listDashboards, shareablePeople } from "@/server/services/reports/saved";
import { listSchedules } from "@/server/services/reports/schedules";
import { ReportSchedules } from "@/components/reports/report-schedules";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { ResultView } from "@/components/reports/result-view";
import { AddToDashboard, DeleteButton } from "@/components/reports/saved-actions";
import { ExportLinks } from "@/components/reports/export-links";
import { NoReportAccess, ReportShell, qs, reportFilters } from "@/components/reports/report-page";
import { fmt } from "@/lib/utils";

export const metadata = { title: "Saved report" };

const VIS: Record<string, string> = { private: "Only the owner", people: "Shared with specific people", everyone: "Everyone who can open reports" };

export default async function SavedReportPage(props: PageProps<"/reports/saved/[id]">) {
  const actor = await requireActor();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  if (!reportFilters(actor, {})) return <NoReportAccess />;
  let report: Awaited<ReturnType<typeof getSavedReport>>;
  try {
    report = await getSavedReport(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  // The URL's filters win; otherwise the report opens with the filters it was saved with.
  const hasUrlFilters = ["range", "brandId", "departmentId", "jobId"].some((k) => typeof sp[k] === "string");
  const f = reportFilters(actor, hasUrlFilters ? sp : report.filters)!;
  const def = validateDefinition(report.definition);
  const q = encodeDefinition(def);
  let result: ReportResult | null = null;
  let blocked: string | null = null;
  try {
    result = await runReport(actor, def, f);
  } catch (e) {
    if (e instanceof ForbiddenError) blocked = e.message;
    else throw e;
  }
  const params = filtersToParams(f);
  const recordsHref = (keys: (string | null)[]) => `/reports/builder/records${qs({ ...params, q, k: JSON.stringify(keys.map((k) => k ?? "∅")), from: `/reports/saved/${id}` })}`;
  const dashboards = (await listDashboards(actor)).filter((d) => d.mine);
  const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const scheduleRows = report.canEdit
    ? (await listSchedules(actor, report.id)).map((s) => {
        const at = `${s.hour % 12 || 12}:00 ${s.hour < 12 ? "AM" : "PM"}`;
        const when = s.frequency === "daily" ? `Every day at ${at}` : s.frequency === "weekly" ? `Every ${DAYS[s.dayOfWeek ?? 0]} at ${at}` : `Monthly on day ${s.dayOfMonth} at ${at}`;
        const lr = s.lastResult as { delivered?: number; skipped?: number; failed?: number } | null;
        return {
          id: s.id,
          summary: `${when} · ${s.format === "xlsx" ? "Excel" : "CSV"}`,
          nextRun: fmt(s.nextRunAt, "EEE MMM d, h:mm a", s.timezone),
          lastResult: lr ? `${lr.delivered ?? 0} sent${lr.skipped ? `, ${lr.skipped} skipped` : ""}${lr.failed ? `, ${lr.failed} failed` : ""}` : null,
          active: s.active,
          recipients: s.recipients,
        };
      })
    : [];
  // People who can open this report, as schedule recipients.
  const recipientChoices = report.canEdit
    ? [
        { id: actor.id, name: actor.name },
        ...(report.visibility === "everyone" ? await shareablePeople(actor) : report.visibility === "people" ? report.sharedWith : []).filter((p) => p.id !== actor.id),
      ]
    : [];

  return (
    <ReportShell actor={actor} tab="saved" filters={f} subtitle={`Saved report by ${report.owner.name} · ${VIS[report.visibility]}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{report.name}</h2>
          {report.description && <p className="text-xs text-zinc-600">{report.description}</p>}
          {report.visibility === "people" && <p className="text-xs text-zinc-500">Shared with {report.sharedWith.map((u) => u.name).join(", ") || "nobody yet"}.</p>}
        </div>
        <div className="flex items-center gap-2">
          <AddToDashboard reportId={report.id} dashboards={dashboards} />
          <Link href={`/reports/builder${qs({ ...params, q, ...(report.canEdit ? { edit: report.id } : {}) })}`} className={buttonClass("secondary")}>
            <Pencil size={14} /> {report.canEdit ? "Edit" : "Copy to builder"}
          </Link>
          {report.canEdit && <DeleteButton kind="report" id={report.id} name={report.name} />}
        </div>
      </div>
      <Card className="overflow-hidden">
        <CardHeader title={result ? result.dataset.label : "Report"} action={result ? <ExportLinks params={{ ...params, kind: "saved", id: report.id }} /> : undefined} />
        {blocked ? <EmptyState title="Not available" description={blocked} /> : result && <ResultView result={result} recordsHref={recordsHref} />}
      </Card>
      {report.canEdit && (
        <Card>
          <CardHeader title="Scheduled delivery" action={<span className="text-xs text-zinc-500">By email, with the report attached</span>} />
          <ReportSchedules reportId={report.id} schedules={scheduleRows} people={recipientChoices.map((p) => ({ id: p.id, name: p.name }))} me={actor.id} timezone={actor.timezone} />
        </Card>
      )}
    </ReportShell>
  );
}
