import Link from "next/link";
import { requireActor } from "@/lib/session";
import { getPipelineSnapshot } from "@/server/services/reports/snapshot";
import { STAGE_TYPE_LABELS, type StageTypeKey } from "@/server/services/reports/metrics";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { StatTile } from "@/components/reports/stat-tile";
import { SnapshotDatePicker } from "@/components/reports/snapshot-date";
import { nf } from "@/components/reports/format";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";
import { fmt } from "@/lib/utils";

export const metadata = { title: "Pipeline snapshot" };

const COLUMNS: StageTypeKey[] = ["lead", "review", "screen", "interview", "offer"];

function delta(then: number, now: number) {
  const d = now - then;
  if (d === 0) return "no change";
  return `${d > 0 ? "+" : "−"}${nf.format(Math.abs(d))} since`;
}

export default async function SnapshotReport(props: PageProps<"/reports/snapshot">) {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const f = reportFilters(actor, sp);
  if (!f) return <NoReportAccess />;
  const today = fmt(new Date(), "yyyy-MM-dd", f.tz);
  const asOfRaw = typeof sp.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.asOf) ? sp.asOf : null;
  const asOfDay = asOfRaw && asOfRaw <= today ? asOfRaw : f.fromDay;
  const snap = await getPipelineSnapshot(actor, f, asOfDay);
  const label = fmt(`${asOfDay}T12:00:00Z`, "MMMM d, yyyy", "UTC");

  return (
    <ReportShell actor={actor} tab="snapshot" filters={f} extra={{ asOf: asOfDay }} subtitle="The pipeline as it stood at the end of a past day, rebuilt from the stage history. Brand, department and job filters apply.">
      <div className="flex flex-wrap items-center gap-3">
        <SnapshotDatePicker value={asOfDay} max={today} />
        <span className="text-xs text-zinc-500">Compared with today ({fmt(new Date(), "MMM d", f.tz)}).</span>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label={`Active on ${label}`} value={nf.format(snap.then.activeTotal)} sub={`${nf.format(snap.now.activeTotal)} today`} />
        {(["screen", "interview", "offer"] as const).map((t) => (
          <StatTile key={t} label={`In ${STAGE_TYPE_LABELS[t].toLowerCase()}`} value={nf.format(snap.then.active[t])} sub={`${nf.format(snap.now.active[t])} today · ${delta(snap.then.active[t], snap.now.active[t])}`} />
        ))}
      </div>
      <Card className="overflow-hidden">
        <CardHeader title={`Active applications by job on ${label}`} action={<span className="text-xs text-zinc-500">{nf.format(snap.then.hired)} hired · {nf.format(snap.then.archived)} archived by then</span>} />
        {snap.jobs.length === 0 ? (
          <EmptyState title="No active applications" description="Nothing was in the pipeline on that day for these filters." />
        ) : (
          <table className="w-full" aria-label={`Pipeline on ${label}`}>
            <thead className="border-b border-zinc-100">
              <tr className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-4 py-2 text-left font-medium">Job</th>
                {COLUMNS.map((c) => (
                  <th key={c} className="px-3 py-2 text-right font-medium">
                    {STAGE_TYPE_LABELS[c]}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-medium">Active then</th>
                <th className="px-4 py-2 text-right font-medium">Active today</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {snap.jobs.map((j) => (
                <tr key={j.jobId} className="hover:bg-zinc-50/60">
                  <td className="px-4 py-2 text-[13px]">
                    <Link href={`/jobs/${j.jobId}`} className="hover:underline">
                      {j.title}
                    </Link>
                    <span className="block text-xs text-zinc-500">{j.brand}</span>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c} className="px-3 py-2 text-right text-xs tabular-nums">
                      {/* Cell shading carries magnitude; the number is always printed. */}
                      <span className="inline-block min-w-8 rounded px-1.5 py-0.5" style={{ background: j.active[c] ? `color-mix(in srgb, var(--pats-warm-neutral) ${Math.min(80, 12 + j.active[c] * 8)}%, transparent)` : undefined }}>
                        {j.active[c] ? nf.format(j.active[c]) : "·"}
                      </span>
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-xs font-medium tabular-nums">{nf.format(j.activeTotal)}</td>
                  <td className="px-4 py-2 text-right text-xs text-zinc-600 tabular-nums">{nf.format(j.activeNow)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </ReportShell>
  );
}
