import Link from "next/link";
import { cn } from "@/lib/utils";

export type BarRow = {
  key: string;
  label: React.ReactNode;
  value: number;
  valueLabel: string;
  /** Drill-down to the records behind the number. */
  href?: string;
  cells?: React.ReactNode[];
};

/**
 * A table whose first numeric column carries an inline horizontal bar: the chart and its table view
 * in one (every value is printed, so hover only adds detail, never gates it).
 */
export function BarTable({
  label,
  barHeader,
  headers = [],
  rows,
  max,
  barWidth = "40%",
  empty = "No data for these filters.",
}: {
  label: string;
  barHeader: string;
  headers?: string[];
  rows: BarRow[];
  max?: number;
  /** Width of the bar column; narrower when the table has many columns. */
  barWidth?: string;
  empty?: string;
}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <div className="px-4 py-8 text-center text-xs text-zinc-500">{empty}</div>;
  return (
    <table className="w-full" aria-label={label}>
      <thead className="border-b border-zinc-100">
        <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
          <th className="px-4 py-2 font-medium">&nbsp;</th>
          <th className="px-3 py-2 font-medium" style={{ width: barWidth }}>
            {barHeader}
          </th>
          {headers.map((h) => (
            <th key={h} className="px-3 py-2 text-right font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-zinc-100">
        {rows.map((r) => {
          const w = Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100);
          const bar = (
            <span className="flex items-center gap-2">
              <span className="relative h-3 flex-1">
                <span
                  className="absolute inset-y-0 left-0 rounded-r-[4px] bg-zinc-800 transition-colors group-hover/bar:bg-zinc-600"
                  style={{ width: `${Math.min(100, w)}%` }}
                />
              </span>
              <span className="w-16 shrink-0 text-right text-xs font-medium text-zinc-900 tabular-nums">{r.valueLabel}</span>
            </span>
          );
          return (
            <tr key={r.key} className="hover:bg-zinc-50/60">
              <td className="px-4 py-2 text-[13px]">{r.label}</td>
              <td className="px-3 py-2">
                {r.href ? (
                  <Link href={r.href} className="group/bar block rounded focus-visible:ring-2 focus-visible:ring-accent-500" title="See records">
                    {bar}
                  </Link>
                ) : (
                  bar
                )}
              </td>
              {(r.cells ?? []).map((c, i) => (
                <td key={i} className={cn("px-3 py-2 text-right text-xs text-zinc-700 tabular-nums")}>
                  {c}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
