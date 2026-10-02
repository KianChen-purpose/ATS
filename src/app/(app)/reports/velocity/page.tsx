import Link from "next/link";
import { requireActor } from "@/lib/session";
import { getVelocity } from "@/server/services/reports/standard";
import { STAGE_TYPE_LABELS } from "@/server/services/reports/metrics";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/reports/stat-tile";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { daysLabel, nf } from "@/components/reports/format";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Velocity report" };

export default async function VelocityReport(props: PageProps<"/reports/velocity">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const v = await getVelocity(actor, f);

  return (
    <ReportShell actor={actor} tab="velocity" filters={f}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <StatTile label="Time to hire" metric="time_to_hire" value={daysLabel(v.timeToHire.median)} sub={`median of ${nf.format(v.timeToHire.n)} hires · average ${daysLabel(v.timeToHire.average)}`} />
        <StatTile label="Time to first touch" metric="time_to_first_touch" value={daysLabel(v.timeToFirstTouch.median)} sub={`${nf.format(v.timeToFirstTouch.waiting)} applications still untouched`} />
        <StatTile label="Time to fill" metric="time_to_fill" value={daysLabel(v.timeToFill.median)} sub={`median of ${nf.format(v.timeToFill.n)} openings filled`} />
      </div>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1">
              Time in stage <Definition metric="time_in_stage" />
            </span>
          }
        />
        <BarTable
          label="Median days in stage"
          barHeader="Median days"
          headers={["Stage exits"]}
          rows={v.timeInStage.map((r) => ({ key: r.type, label: STAGE_TYPE_LABELS[r.type], value: r.median, valueLabel: daysLabel(r.median), cells: [nf.format(r.n)] }))}
          empty="No stage moves in this range."
        />
      </Card>
      <Card>
        <CardHeader title="Time to hire by job" />
        <BarTable
          label="Median time to hire by job"
          barHeader="Median days to hire"
          headers={["Hires"]}
          rows={v.byJob.map((r) => ({
            key: r.job_id,
            label: (
              <Link href={`/jobs/${r.job_id}`} className="hover:underline">
                {r.title}
                <span className="ml-1.5 text-xs text-zinc-500">{r.brand}</span>
              </Link>
            ),
            value: r.median,
            valueLabel: daysLabel(r.median),
            cells: [nf.format(r.hires)],
          }))}
          empty="No hires in this range."
        />
      </Card>
    </ReportShell>
  );
}
