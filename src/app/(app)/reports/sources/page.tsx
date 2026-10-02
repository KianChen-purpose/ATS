import { requireActor } from "@/lib/session";
import { getSources } from "@/server/services/reports/standard";
import { Card, CardHeader } from "@/components/ui/card";
import { BarTable } from "@/components/reports/bar-table";
import { Definition } from "@/components/reports/definition";
import { nf, pct, ratio } from "@/components/reports/format";
import { NoReportAccess, ReportShell, drillHref, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Source report" };

const CATEGORY_LABELS: Record<string, string> = {
  inbound: "Inbound (career site)",
  referral: "Referral",
  agency: "Agency",
  sourced: "Sourced",
  internal: "Internal",
  unknown: "Unknown",
};

export default async function SourcesReport(props: PageProps<"/reports/sources">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const { sources, categories } = await getSources(actor, f);
  const headers = ["Reached interview", "Offers", "Hires", "Hire rate"];
  const cells = (r: { applications: number; interviewed: number; offers: number; hires: number }) => [
    `${nf.format(r.interviewed)} (${pct(ratio(r.interviewed, r.applications))})`,
    nf.format(r.offers),
    nf.format(r.hires),
    pct(ratio(r.hires, r.applications), 1),
  ];

  return (
    <ReportShell actor={actor} tab="sources" filters={f} subtitle="Where applications in the date range came from, and how far they got.">
      <Card>
        <CardHeader
          title={
            <span className="flex items-center gap-1">
              By source type <Definition metric="hire_rate" />
            </span>
          }
        />
        <BarTable
          label="Applications by source type"
          barHeader="Applications"
          headers={headers}
          rows={categories.map((r) => ({ key: r.category, label: CATEGORY_LABELS[r.category] ?? r.category, value: r.applications, valueLabel: nf.format(r.applications), cells: cells(r) }))}
        />
      </Card>
      <Card>
        <CardHeader title="By source" />
        <BarTable
          label="Applications by source"
          barHeader="Applications"
          headers={headers}
          rows={sources.map((r) => ({
            key: r.source_id ?? "none",
            label: (
              <>
                {r.source}
                <span className="ml-1.5 text-xs text-zinc-500">{CATEGORY_LABELS[r.category ?? "unknown"]}</span>
              </>
            ),
            value: r.applications,
            valueLabel: nf.format(r.applications),
            href: drillHref(f, { set: "source", sourceId: r.source_id ?? "none" }),
            cells: cells(r),
          }))}
        />
      </Card>
    </ReportShell>
  );
}
