import Link from "next/link";
import { requireActor } from "@/lib/session";
import { drillDown, drillSchema, describeDrill, DRILL_LIMIT } from "@/server/services/reports/drilldown";
import { filtersToParams } from "@/server/services/reports/filters";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/card";
import { Avatar } from "@/components/ui/avatar";
import { nf } from "@/components/reports/format";
import { NoReportAccess, ReportShell, qs, reportFilters } from "@/components/reports/report-page";
import { fmt } from "@/lib/utils";
import { ExportLinks } from "@/components/reports/export-links";

export const metadata = { title: "Report records" };

const STATUS: Record<string, string> = { active: "Active", archived: "Archived", hired: "Hired" };

export default async function ReportRecords(props: PageProps<"/reports/records">) {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const f = reportFilters(actor, sp);
  if (!f) return <NoReportAccess />;
  const parsed = drillSchema.safeParse(Object.fromEntries(Object.entries(sp).filter(([, v]) => typeof v === "string")));
  const set = parsed.success ? parsed.data : ({ set: "applied" } as const);
  const { rows, truncated } = await drillDown(actor, f, set);
  const title = describeDrill(set, set.set === "source" ? (rows[0]?.source ?? undefined) : undefined);

  return (
    <ReportShell actor={actor} tab="overview" filters={f} extra={Object.fromEntries(Object.entries(set).map(([k, v]) => [k, String(v)]))} subtitle={`${title} · ${nf.format(rows.length)}${truncated ? "+" : ""} records`}>
      <div className="flex items-center justify-between text-xs">
        <Link href={`/reports${qs(filtersToParams(f))}`} className="text-zinc-600 hover:underline">
          ← Back to reports
        </Link>
        {rows.length > 0 && <ExportLinks params={{ ...filtersToParams(f), kind: "drill", ...Object.fromEntries(Object.entries(set).map(([k, v]) => [k, String(v)])) }} />}
      </div>
      <Card className="overflow-hidden">
        {rows.length === 0 ? (
          <EmptyState title="No records" description="Nothing matches these filters." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50/60">
              <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-4 py-2">Candidate</th>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Source</th>
                <th className="px-4 py-2 text-right">Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.application_id} className="hover:bg-zinc-50">
                  <td className="px-4 py-2">
                    <Link href={`/candidates/${r.candidate_id}?app=${r.application_id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                      <Avatar name={`${r.first_name} ${r.last_name}`} size={24} />
                      {r.first_name} {r.last_name}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/jobs/${r.job_id}`} className="hover:underline">
                      {r.job_title}
                    </Link>
                    <div className="text-xs text-zinc-500">{r.brand}</div>
                  </td>
                  <td className="px-3 py-2 text-xs">{r.stage}</td>
                  <td className="px-3 py-2 text-xs">{STATUS[r.status] ?? r.status}</td>
                  <td className="px-3 py-2 text-xs text-zinc-600">{r.source ?? "—"}</td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-500 tabular-nums">{fmt(r.applied_at, "MMM d, yyyy", f.tz)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {truncated && <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">Showing the {nf.format(DRILL_LIMIT)} most recent. Narrow the filters to see the rest.</div>}
      </Card>
    </ReportShell>
  );
}
