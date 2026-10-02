import Link from "next/link";
import { requireActor } from "@/lib/session";
import { getFunnel } from "@/server/services/reports/standard";
import { STAGE_TYPE_LABELS } from "@/server/services/reports/metrics";
import { Card, CardHeader } from "@/components/ui/card";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { nf, pct } from "@/components/reports/format";
import { NoReportAccess, ReportShell, drillHref, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Pipeline report" };

export default async function PipelineReport(props: PageProps<"/reports/pipeline">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const { total, funnel, archiveReasons } = await getFunnel(actor, f);
  const archivedTotal = archiveReasons.reduce((n, r) => n + r.n, 0);
  const num = (n: number, href: string) =>
    n > 0 ? (
      <Link href={href} className="underline-offset-2 hover:underline">
        {nf.format(n)}
      </Link>
    ) : (
      "0"
    );

  return (
    <ReportShell actor={actor} tab="pipeline" filters={f} subtitle="Applications created in the date range, followed to wherever they are now.">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1">
              Funnel by stage type <Definition metric="stage_conversion" />
            </span>
          }
          action={<span className="text-xs text-zinc-500">{nf.format(total)} applications</span>}
        />
        <BarTable
          label="Funnel by stage type"
          barHeader="Reached this stage or later"
          headers={["Conversion to next", "Active here now", "Archived here"]}
          max={total}
          rows={funnel.map((r) => ({
            key: r.stage,
            label: r.stage === "lead" ? "All applications" : STAGE_TYPE_LABELS[r.stage],
            value: r.reached,
            valueLabel: nf.format(r.reached),
            href: drillHref(f, r.stage === "lead" ? { set: "applied" } : { set: "reached", stage: r.stage }),
            cells: [
              r.stage === "hired" ? "—" : pct(r.conversion),
              num(r.active, drillHref(f, { set: "active_at", stage: r.stage })),
              num(r.archived, drillHref(f, { set: "archived_at", stage: r.stage })),
            ],
          }))}
        />
      </Card>
      <Card>
        <CardHeader title="Why applications were archived" action={<span className="text-xs text-zinc-500">{nf.format(archivedTotal)} archived</span>} />
        <BarTable
          label="Archive reasons"
          barHeader="Applications"
          headers={["Share", "Category"]}
          rows={archiveReasons.map((r) => ({
            key: r.reason,
            label: r.reason,
            value: r.n,
            valueLabel: nf.format(r.n),
            cells: [pct(archivedTotal ? r.n / archivedTotal : null), <span key="c" className="capitalize">{r.category ?? "—"}</span>],
          }))}
          empty="Nothing was archived in this range."
        />
      </Card>
    </ReportShell>
  );
}
