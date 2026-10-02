import { nf, niceTicks } from "./format";

export type ColumnPoint = { key: string; tick?: string; caption: string; value: number; unit: string };

/** Drops x labels that would crowd the previous one. */
function spacedTicks(points: ColumnPoint[]) {
  const out: (string | undefined)[] = [];
  let last = -99;
  points.forEach((p, i) => {
    if (p.tick && i - last >= 3) {
      out.push(p.tick);
      last = i;
    } else out.push(undefined);
  });
  return out;
}

/**
 * Single-series column chart (one hue, so no legend: the card title names it). Columns ≤ 24px with a
 * 4px rounded cap, hairline gridlines, clean ticks; each column shows its value on hover or focus.
 */
export function ColumnChart({ points, label, height = 150 }: { points: ColumnPoint[]; label: string; height?: number }) {
  const { max, ticks } = niceTicks(Math.max(0, ...points.map((p) => p.value)));
  const xTicks = spacedTicks(points);
  return (
    <figure aria-label={label} className="px-4 pt-3 pb-2">
      <div className="flex gap-2">
        <div className="relative w-8 shrink-0 text-right text-[10px] text-zinc-500 tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / max) * 100}%` }}>
              {nf.format(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative" style={{ height }}>
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-zinc-200" style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
            </div>
            <ol className="relative flex h-full items-end gap-[2px]">
              {points.map((p) => (
                <li key={p.key} className="group relative flex h-full flex-1 items-end justify-center outline-none" tabIndex={0} aria-label={`${nf.format(p.value)} ${p.unit}, ${p.caption}`}>
                  <span
                    className="w-full max-w-6 rounded-t-[4px] bg-zinc-800 group-hover:bg-zinc-600 group-focus-visible:bg-zinc-600"
                    style={{ height: `${(p.value / max) * 100}%`, minHeight: p.value > 0 ? 2 : 0 }}
                  />
                  <span
                    role="tooltip"
                    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] whitespace-nowrap text-zinc-600 shadow group-hover:block group-focus-visible:block"
                  >
                    <strong className="block text-[13px] text-zinc-900">{nf.format(p.value)}</strong>
                    {p.unit} · {p.caption}
                  </span>
                </li>
              ))}
            </ol>
          </div>
          <div className="mt-1 flex gap-[2px] text-[10px] text-zinc-500" aria-hidden>
            {points.map((p, i) => (
              <span key={p.key} className="relative flex-1 whitespace-nowrap">
                {xTicks[i]}
              </span>
            ))}
          </div>
        </div>
      </div>
    </figure>
  );
}
