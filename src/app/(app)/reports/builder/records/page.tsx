import Link from "next/link";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import { ForbiddenError } from "@/server/policy";
import { decodeDefinition, encodeDefinition, reportRecords, RECORD_LIMIT } from "@/server/services/reports/builder";
import { datasetByKey } from "@/server/services/reports/datasets";
import { filtersToParams } from "@/server/services/reports/filters";
import { Card, EmptyState } from "@/components/ui/card";
import { nf } from "@/components/reports/format";
import { timeLabel } from "@/components/reports/result-format";
import { ExportLinks } from "@/components/reports/export-links";
import { NoReportAccess, ReportShell, qs, reportFilters } from "@/components/reports/report-page";
import { fmt, money } from "@/lib/utils";

export const metadata = { title: "Report records" };

const keysSchema = z.array(z.string().max(300)).max(2);

export default async function BuilderRecords(props: PageProps<"/reports/builder/records">) {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const f = reportFilters(actor, sp);
  if (!f) return <NoReportAccess />;
  const def = decodeDefinition(typeof sp.q === "string" ? sp.q : null);
  let keys: string[] = [];
  try {
    keys = keysSchema.parse(JSON.parse(typeof sp.k === "string" ? sp.k : "[]"));
  } catch {
    keys = [];
  }
  const back = typeof sp.from === "string" && /^\/reports\/(saved|dashboards)\/[0-9a-f-]{36}$/.test(sp.from) ? sp.from : "/reports/builder";
  const q = encodeDefinition(def);
  let data: Awaited<ReturnType<typeof reportRecords>> | null = null;
  let blocked: string | null = null;
  try {
    data = await reportRecords(actor, def, f, keys);
  } catch (e) {
    if (e instanceof ForbiddenError) blocked = e.message;
    else throw e;
  }
  const ds = datasetByKey(def.dataset)!;
  const scope = keys
    .map((k, i) => {
      const dim = ds.dimensions.find((d) => d.key === def.groupBy[i]);
      return `${dim?.label}: ${timeLabel(k === "∅" ? null : k, dim?.key ?? "")}`;
    })
    .join(" · ");

  return (
    <ReportShell actor={actor} tab="builder" filters={f} extra={{ q, k: JSON.stringify(keys), ...(back !== "/reports/builder" ? { from: back } : {}) }} subtitle={`${ds.label}${scope ? ` · ${scope}` : ""}${data ? ` · ${nf.format(data.rows.length)}${data.truncated ? "+" : ""} records` : ""}`}>
      <div className="flex items-center justify-between text-xs">
        <Link href={`${back}${qs({ ...filtersToParams(f), ...(back === "/reports/builder" ? { q } : {}) })}`} className="text-zinc-600 hover:underline">
          ← Back to the report
        </Link>
        {data && data.rows.length > 0 && <ExportLinks params={{ ...filtersToParams(f), kind: "records", q, k: JSON.stringify(keys) }} />}
      </div>
      <Card className="overflow-hidden">
        {blocked ? (
          <EmptyState title="Not available" description={blocked} />
        ) : !data || data.rows.length === 0 ? (
          <EmptyState title="No records" description="Nothing matches this row any more." />
        ) : (
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50/60">
              <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-4 py-2">{data.candidate ? "Candidate" : "Opening"}</th>
                <th className="px-3 py-2">Job</th>
                {data.columns.map((c) => (
                  <th key={c.key} className={c.format === "date" || c.format === "money" ? "px-3 py-2 text-right" : "px-3 py-2"}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {data.rows.map((r, i) => (
                <tr key={`${r.application_id ?? r.candidate}-${i}`} className="hover:bg-zinc-50">
                  <td className="px-4 py-2 font-medium">
                    {r.candidate_id ? (
                      <Link href={`/candidates/${r.candidate_id}?app=${r.application_id}`} className="hover:underline">
                        {r.candidate}
                      </Link>
                    ) : (
                      r.candidate
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link href={`/jobs/${r.job_id}`} className="hover:underline">
                      {r.job}
                    </Link>
                  </td>
                  {data.columns.map((c) => {
                    const v = r[c.key];
                    return (
                      <td key={c.key} className={c.format === "date" || c.format === "money" ? "px-3 py-2 text-right text-xs text-zinc-600 tabular-nums" : "px-3 py-2 text-xs"}>
                        {v == null ? "—" : c.format === "date" ? fmt(v as string, "MMM d, yyyy", f.tz) : c.format === "money" ? money(Number(v)) : String(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data?.truncated && <div className="border-t border-zinc-100 px-4 py-2 text-xs text-zinc-500">Showing the {nf.format(RECORD_LIMIT)} most recent.</div>}
      </Card>
    </ReportShell>
  );
}
