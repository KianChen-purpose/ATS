import Link from "next/link";
import { requireActor } from "@/lib/session";
import { getHeadcount } from "@/server/services/reports/standard";
import { Card, CardHeader } from "@/components/ui/card";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { nf } from "@/components/reports/format";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Headcount report" };

export default async function HeadcountReport(props: PageProps<"/reports/headcount">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const h = await getHeadcount(actor, f);

  return (
    <ReportShell actor={actor} tab="headcount" filters={f} subtitle="Openings and open jobs. Open counts are as of now; filled and created use the date range.">
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1">
                Openings by brand <Definition metric="open_openings" />
              </span>
            }
          />
          <BarTable
            label="Open openings by brand"
            barHeader="Open openings"
            headers={["Open jobs", "Created in range", "Filled in range"]}
            rows={h.byBrand.map((r) => ({
              key: r.brand_id,
              label: r.brand,
              value: r.open_openings,
              valueLabel: nf.format(r.open_openings),
              cells: [nf.format(r.open_jobs), nf.format(r.created), nf.format(r.filled)],
            }))}
          />
        </Card>
        <Card>
          <CardHeader
            title={
              <span className="flex items-center gap-1">
                Job age <Definition metric="job_age" />
              </span>
            }
          />
          <BarTable label="Open jobs by age" barHeader="Open jobs" rows={h.buckets.map((b) => ({ key: b.label, label: b.label, value: b.jobs, valueLabel: nf.format(b.jobs) }))} />
        </Card>
      </div>
      <Card>
        <CardHeader title="Oldest open jobs" />
        <BarTable
          label="Open jobs by days open"
          barHeader="Days open"
          headers={["Open openings", "Active candidates", "Recruiter"]}
          barWidth="30%"
          rows={h.aging.slice(0, 15).map((j) => ({
            key: j.job_id,
            label: (
              <Link href={`/jobs/${j.job_id}`} className="hover:underline">
                {j.title}
                <span className="ml-1.5 text-xs text-zinc-500">
                  {j.brand}
                  {j.status === "on_hold" && " · on hold"}
                </span>
              </Link>
            ),
            value: j.days_open,
            valueLabel: `${nf.format(j.days_open)}d`,
            cells: [nf.format(j.open_openings), nf.format(j.active), j.recruiter ?? "—"],
          }))}
          empty="No open jobs."
        />
      </Card>
    </ReportShell>
  );
}
