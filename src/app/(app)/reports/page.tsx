import { requireActor } from "@/lib/session";
import { getFunnel, getOverview } from "@/server/services/reports/standard";
import { STAGE_TYPE_LABELS } from "@/server/services/reports/metrics";
import { Card, CardHeader } from "@/components/ui/card";
import { StatRow, StatTile } from "@/components/reports/stat-tile";
import { ColumnChart, type ColumnPoint } from "@/components/reports/column-chart";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { daysLabel, nf, pct } from "@/components/reports/format";
import { NoReportAccess, ReportShell, drillHref, reportFilters } from "@/components/reports/report-page";
import { fmt } from "@/lib/utils";

export const metadata = { title: "Reports" };

function weeklyPoints(weekly: { week: string; applications: number; hires: number }[], key: "applications" | "hires", unit: string): ColumnPoint[] {
  let lastMonth = "";
  return weekly.map((w) => {
    const d = `${w.week}T12:00:00Z`;
    const month = fmt(d, "MMM", "UTC");
    const tick = month !== lastMonth ? month : undefined;
    lastMonth = month;
    return { key: w.week, tick, value: w[key], unit, caption: `week of ${fmt(d, "MMM d, yyyy", "UTC")}` };
  });
}

export default async function ReportsOverview(props: PageProps<"/reports">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const [o, funnel] = await Promise.all([getOverview(actor, f), getFunnel(actor, f)]);

  return (
    <ReportShell actor={actor} tab="overview" filters={f}>
      <StatRow>
        <StatTile label="Applications" metric="applications" value={nf.format(o.applications)} sub={`${nf.format(o.activeApplications)} active now`} href={drillHref(f, { set: "applied" })} />
        <StatTile label="Hires" metric="hires" value={nf.format(o.hires)} href={drillHref(f, { set: "hired" })} />
        <StatTile label="Offer acceptance" metric="offer_acceptance_rate" value={pct(o.acceptanceRate)} sub={`${o.offersAccepted} accepted · ${o.offersDeclined} declined`} />
        <StatTile label="Time to hire" metric="time_to_hire" value={daysLabel(o.medianTimeToHire)} sub="median" />
        <StatTile label="Open jobs" value={nf.format(o.openJobs)} />
        <StatTile label="Open openings" metric="open_openings" value={nf.format(o.openOpenings)} />
      </StatRow>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Applications per week" />
          <ColumnChart label="Applications per week" points={weeklyPoints(o.weekly, "applications", "applications")} />
        </Card>
        <Card>
          <CardHeader title="Hires per week" />
          <ColumnChart label="Hires per week" points={weeklyPoints(o.weekly, "hires", "hires")} />
        </Card>
      </div>

      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1">
              Pipeline funnel <Definition metric="stage_conversion" />
            </span>
          }
        />
        <BarTable
          label="Pipeline funnel"
          barHeader="Reached"
          headers={["Share of applications", "Conversion to next"]}
          rows={funnel.funnel
            .filter((r) => r.stage !== "lead")
            .map((r) => ({
              key: r.stage,
              label: STAGE_TYPE_LABELS[r.stage],
              value: r.reached,
              valueLabel: nf.format(r.reached),
              href: drillHref(f, { set: "reached", stage: r.stage }),
              cells: [pct(funnel.total ? r.reached / funnel.total : null), r.stage === "hired" ? "—" : pct(r.conversion)],
            }))}
          max={funnel.total}
        />
      </Card>
    </ReportShell>
  );
}
