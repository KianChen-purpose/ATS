import Link from "next/link";
import type { ReportResult } from "@/server/services/reports/builder";
import { MAX_PIVOT_COLUMNS, NONE } from "@/server/services/reports/builder";
import { EmptyState } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BarTable } from "./bar-table";
import { LineChart } from "./line-chart";
import { formatValue, keyLabel, timeLabel } from "./result-format";

type Props = {
  result: ReportResult;
  /** Link to the records behind a row (its dimension values). */
  recordsHref: (keys: (string | null)[]) => string;
  compact?: boolean;
};

const encodeKey = (k: string | null) => k ?? NONE;

export function ResultView({ result, recordsHref, compact = false }: Props) {
  const dims = result.columns.filter((c) => c.kind === "dimension");
  const metrics = result.columns.filter((c) => c.kind === "metric");
  const viz = result.definition.visualization;
  const label = (k: string | null, i = 0) => (dims[i]?.time ? timeLabel(k, dims[i].key) : keyLabel(k));
  const rowLabel = (keys: (string | null)[]) => keys.map((k, i) => label(k, i)).join(" · ");

  if (result.rows.length === 0 || metrics.length === 0) {
    return <EmptyState title="No results" description={metrics.length === 0 ? "None of the chosen metrics are available to you." : "Nothing matches these filters and dates."} />;
  }

  const notes = (
    <>
      {result.truncated && <p className="px-4 py-2 text-xs text-zinc-500">Showing the first {result.rows.length} groups. Add a filter to narrow it down.</p>}
      {result.hiddenMetrics.length > 0 && <p className="px-4 py-2 text-xs text-zinc-500">Hidden for your role: {result.hiddenMetrics.join(", ")}.</p>}
    </>
  );

  if (viz === "pivot" && dims.length === 2) {
    // First metric, dimension 1 down the side, dimension 2 across.
    const m = metrics[0];
    // Columns: chronological for time buckets, otherwise largest first, so the layout doesn't depend on row order.
    const colTotals = new Map<string | null, number>();
    for (const r of result.rows) colTotals.set(r.keys[1], (colTotals.get(r.keys[1]) ?? 0) + (r.values[0] ?? 0));
    const colKeys = [...colTotals.keys()]
      .sort((a, b) => (dims[1].time ? String(a ?? "~").localeCompare(String(b ?? "~")) : colTotals.get(b)! - colTotals.get(a)!))
      .slice(0, MAX_PIVOT_COLUMNS);
    const rowKeys = [...new Set(result.rows.map((r) => r.keys[0]))];
    const cell = new Map(result.rows.map((r) => [`${encodeKey(r.keys[0])}|${encodeKey(r.keys[1])}`, r.values[0]]));
    const max = Math.max(1, ...result.rows.map((r) => r.values[0] ?? 0));
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-xs" aria-label={`${m.label} by ${dims[0].label} and ${dims[1].label}`}>
          <thead className="border-b border-zinc-100">
            <tr className="text-[11px] font-medium text-zinc-500">
              <th className="sticky left-0 bg-white px-4 py-2 text-left font-medium">
                {dims[0].label} ↓ / {dims[1].label} →
              </th>
              {colKeys.map((c) => (
                <th key={encodeKey(c)} className="px-2 py-2 text-right font-medium whitespace-nowrap">
                  {label(c, 1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rowKeys.map((rk) => (
              <tr key={encodeKey(rk)}>
                <td className="sticky left-0 bg-white px-4 py-1.5 text-[13px] whitespace-nowrap">{label(rk, 0)}</td>
                {colKeys.map((ck) => {
                  const v = cell.get(`${encodeKey(rk)}|${encodeKey(ck)}`) ?? null;
                  return (
                    <td key={encodeKey(ck)} className="px-2 py-1.5 text-right tabular-nums">
                      {v == null ? (
                        <span className="text-zinc-300">·</span>
                      ) : (
                        <Link
                          href={recordsHref([rk, ck])}
                          className="inline-block min-w-10 rounded px-1.5 py-0.5 hover:underline"
                          style={{ background: m.format === "count" ? `color-mix(in srgb, var(--pats-warm-neutral) ${Math.round(10 + (v / max) * 70)}%, transparent)` : undefined }}
                        >
                          {formatValue(v, m.format)}
                        </Link>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-zinc-500">
          {m.label}. Shading shows magnitude; every value is printed.
        </p>
        {notes}
      </div>
    );
  }

  const chart =
    viz === "line" ? (
      <LineChart
        label={`${metrics[0].label} by ${dims[0].label}`}
        height={compact ? 140 : 190}
        formatTick={(v) => formatValue(v, metrics[0].format)}
        points={result.rows.map((r) => ({ key: encodeKey(r.keys[0]), tick: label(r.keys[0]), value: r.values[0], valueLabel: formatValue(r.values[0], metrics[0].format), caption: label(r.keys[0]) }))}
      />
    ) : null;

  if (viz === "bar" && dims.length > 0) {
    return (
      <>
        <BarTable
          label={`${metrics[0].label} by ${dims.map((d) => d.label).join(" and ")}`}
          barHeader={metrics[0].label}
          headers={metrics.slice(1).map((m) => m.label)}
          barWidth={metrics.length > 2 ? "32%" : "45%"}
          rows={(compact ? result.rows.slice(0, 8) : result.rows).map((r) => ({
            key: r.keys.map(encodeKey).join("|"),
            label: rowLabel(r.keys),
            value: r.values[0] ?? 0,
            valueLabel: formatValue(r.values[0], metrics[0].format),
            href: recordsHref(r.keys),
            cells: r.values.slice(1).map((v, i) => formatValue(v, metrics[i + 1].format)),
          }))}
        />
        {compact && result.rows.length > 8 && <p className="px-4 py-2 text-xs text-zinc-500">Top 8 of {result.rows.length}.</p>}
        {notes}
      </>
    );
  }

  return (
    <>
      {chart}
      {!(compact && chart) && (
        <div className="overflow-x-auto">
          <table className="w-full" aria-label={`${result.dataset.label} report`}>
            <thead className="border-b border-zinc-100">
              <tr className="text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                {dims.map((d) => (
                  <th key={d.key} className="px-4 py-2 text-left font-medium">
                    {d.label}
                  </th>
                ))}
                {metrics.map((m) => (
                  <th key={m.key} className="px-3 py-2 text-right font-medium" title={m.description}>
                    {m.label}
                  </th>
                ))}
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {(compact ? result.rows.slice(0, 10) : result.rows).map((r) => (
                <tr key={r.keys.map(encodeKey).join("|") || "all"} className="hover:bg-zinc-50/60">
                  {r.keys.map((k, i) => (
                    <td key={i} className="px-4 py-1.5 text-[13px]">
                      {label(k, i)}
                    </td>
                  ))}
                  {r.values.map((v, i) => (
                    <td key={i} className="px-3 py-1.5 text-right text-xs tabular-nums">
                      {formatValue(v, metrics[i].format)}
                    </td>
                  ))}
                  <td className="px-2 text-right">
                    <Link href={recordsHref(r.keys)} className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline" aria-label={`Records for ${rowLabel(r.keys) || "all"}`}>
                      →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
            {dims.length > 0 && (
              <tfoot className="border-t border-zinc-200">
                <tr className={cn("text-xs font-semibold")}>
                  <td className="px-4 py-2" colSpan={dims.length}>
                    Total
                  </td>
                  {result.totals.map((v, i) => (
                    <td key={i} className="px-3 py-2 text-right tabular-nums">
                      {formatValue(v, metrics[i].format)}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {notes}
    </>
  );
}
