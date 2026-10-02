import { requireActor } from "@/lib/session";
import { getOfferAnalytics } from "@/server/services/reports/standard";
import { Card, CardHeader } from "@/components/ui/card";
import { StatTile } from "@/components/reports/stat-tile";
import { BarTable } from "@/components/reports/bar-table";
import { daysLabel, nf, pct, ratio } from "@/components/reports/format";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Offer report" };

const STATUS_LABELS: [string, string][] = [
  ["draft", "Draft"],
  ["pending_approval", "Pending approval"],
  ["approved", "Approved"],
  ["sent", "Sent"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["withdrawn", "Withdrawn"],
];

export default async function OffersReport(props: PageProps<"/reports/offers">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const o = await getOfferAnalytics(actor, f);
  const created = Object.values(o.byStatus).reduce((a, b) => a + b, 0);
  const band = o.band;
  const banded = band ? band.below + band.within + band.above : 0;

  return (
    <ReportShell actor={actor} tab="offers" filters={f}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Offer acceptance" metric="offer_acceptance_rate" value={pct(o.acceptanceRate)} sub="of offers decided in range" />
        <StatTile label="Accepted" value={nf.format(o.accepted)} />
        <StatTile label="Declined" value={nf.format(o.declined)} />
        <StatTile label="Time to decision" value={daysLabel(o.medianDaysToDecision)} sub="median, sent → decided" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Offers created in range, by status" action={<span className="text-xs text-zinc-500">{nf.format(created)} offers</span>} />
          <BarTable
            label="Offers by status"
            barHeader="Offers"
            rows={STATUS_LABELS.filter(([k]) => o.byStatus[k]).map(([k, label]) => ({ key: k, label, value: o.byStatus[k], valueLabel: nf.format(o.byStatus[k]) }))}
            empty="No offers created in this range."
          />
        </Card>
        <Card>
          <CardHeader title="Decline reasons" />
          <BarTable
            label="Decline reasons"
            barHeader="Declined offers"
            headers={["Share"]}
            rows={o.declineReasons.map((r) => ({ key: r.reason, label: r.reason, value: r.n, valueLabel: nf.format(r.n), cells: [pct(ratio(r.n, o.declined))] }))}
            empty="No declined offers in this range."
          />
        </Card>
      </div>
      {band && (
        <Card>
          <CardHeader
            title="Base salary vs. the job's band"
            action={<span className="text-xs text-zinc-500">median offer {band.medianPctOfMidpoint == null ? "—" : `${Math.round(band.medianPctOfMidpoint * 100)}% of band midpoint`}</span>}
          />
          <BarTable
            label="Offers relative to band"
            barHeader="Offers"
            headers={["Share"]}
            rows={[
              { key: "below", label: "Below band", value: band.below, valueLabel: nf.format(band.below), cells: [pct(ratio(band.below, banded))] },
              { key: "within", label: "Within band", value: band.within, valueLabel: nf.format(band.within), cells: [pct(ratio(band.within, banded))] },
              { key: "above", label: "Above band", value: band.above, valueLabel: nf.format(band.above), cells: [pct(ratio(band.above, banded))] },
              ...(band.noBand ? [{ key: "none", label: "No band to compare", value: band.noBand, valueLabel: nf.format(band.noBand), cells: ["—"] }] : []),
            ]}
          />
        </Card>
      )}
    </ReportShell>
  );
}
