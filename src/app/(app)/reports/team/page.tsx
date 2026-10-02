import { requireActor } from "@/lib/session";
import { canViewTeamAnalytics } from "@/server/policy";
import { getInterviewerAnalytics, getRecruiterProductivity } from "@/server/services/reports/standard";
import { MIN_SAMPLE } from "@/server/services/reports/metrics";
import { ROLE_LABELS } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { hoursLabel, nf, pct } from "@/components/reports/format";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Team report" };

function signedPts(diff: number) {
  const pts = Math.round(diff * 100);
  return pts === 0 ? "±0 pts" : `${pts > 0 ? "+" : "−"}${Math.abs(pts)} pts`;
}

export default async function TeamReport(props: PageProps<"/reports/team">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  if (!canViewTeamAnalytics(actor)) return <NoReportAccess team />;
  const [recruiters, { interviewers, overallPositiveRate }] = await Promise.all([getRecruiterProductivity(actor, f), getInterviewerAnalytics(actor, f)]);

  return (
    <ReportShell actor={actor} tab="team" filters={f} subtitle="Recruiting team activity and interviewer load, on the jobs you can see.">
      <Card>
        <CardHeader title="Recruiting team" />
        <BarTable
          label="Stage moves by team member"
          barHeader="Stage moves in range"
          headers={["Open jobs", "Applications", "Interviews scheduled", "Hires"]}
          rows={recruiters.map((r) => ({
            key: r.user_id,
            label: (
              <>
                {r.name}
                <span className="ml-1.5 text-xs text-zinc-500">{ROLE_LABELS[r.role]}</span>
              </>
            ),
            value: r.moves,
            valueLabel: nf.format(r.moves),
            cells: [nf.format(r.open_jobs), nf.format(r.applications), nf.format(r.interviews), nf.format(r.hires)],
          }))}
          empty="No recruiting activity in this range."
        />
      </Card>
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1">
              Interviewers <Definition metric="feedback_timeliness" />
            </span>
          }
          action={
            <span className="flex items-center gap-1 text-xs text-zinc-500">
              Team yes rate {pct(overallPositiveRate)} <Definition metric="positive_rate" />
            </span>
          }
        />
        <BarTable
          label="Interviews by interviewer"
          barHeader="Interviews in range"
          headers={["Scorecards", "Median time to submit", "Within 24h", "Yes rate", "vs team"]}
          barWidth="30%"
          rows={interviewers.map((r) => {
            const diff = r.positive_rate != null && overallPositiveRate != null ? r.positive_rate - overallPositiveRate : null;
            return {
              key: r.user_id,
              label: r.name,
              value: r.interviews,
              valueLabel: nf.format(r.interviews),
              cells: [
                `${nf.format(r.submitted)} / ${nf.format(r.interviews)}`,
                hoursLabel(r.median_hours),
                pct(r.within_24h),
                r.positive_rate == null ? <span key="n" title={`Shown from ${MIN_SAMPLE} scorecards`}>—</span> : pct(r.positive_rate),
                diff == null ? "—" : signedPts(diff),
              ],
            };
          })}
          empty="No interviews in this range."
        />
      </Card>
    </ReportShell>
  );
}
