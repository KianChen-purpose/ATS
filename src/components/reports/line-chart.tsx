import { niceTicks } from "./format";

export type LinePoint = { key: string; tick?: string; value: number | null; valueLabel: string; caption: string };

/**
 * Single-series line over time (the card names the series, so no legend). 2px line, ≥8px markers
 * with a surface ring, hairline gridlines and clean ticks. Each point shows its value on hover or
 * keyboard focus; the table under the chart carries every value too.
 */
export function LineChart({ points, label, height = 180, formatTick }: { points: LinePoint[]; label: string; height?: number; formatTick?: (v: number) => string }) {
  const values = points.map((p) => p.value ?? 0);
  const { max, ticks } = niceTicks(Math.max(0, ...values));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? 50 : (i / (n - 1)) * 100);
  const y = (v: number) => 100 - (v / max) * 100;
  const path = points
    .map((p, i) => (p.value == null ? null : `${x(i)},${y(p.value)}`))
    .filter(Boolean)
    .join(" ");
  const fmt = formatTick ?? ((v: number) => String(v));
  const tickEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <figure aria-label={label} className="px-4 pt-3 pb-2">
      <div className="flex gap-2">
        <div className="relative w-10 shrink-0 text-right text-[10px] text-zinc-500 tabular-nums" style={{ height }} aria-hidden>
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: `${(t / max) * 100}%` }}>
              {fmt(t)}
            </span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="relative mx-1.5" style={{ height }}>
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              {ticks.map((t) => (
                <div key={t} className="absolute inset-x-0 border-t border-zinc-200" style={{ bottom: `${(t / max) * 100}%` }} />
              ))}
            </div>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
              <polyline points={path} fill="none" stroke="var(--color-zinc-800)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            </svg>
            <ol className="absolute inset-0">
              {points.map((p, i) =>
                p.value == null ? null : (
                  <li
                    key={p.key}
                    tabIndex={0}
                    aria-label={`${p.valueLabel}, ${p.caption}`}
                    className="group absolute flex size-6 -translate-x-1/2 translate-y-1/2 items-center justify-center outline-none"
                    style={{ left: `${x(i)}%`, bottom: `${100 - y(p.value)}%` }}
                  >
                    <span className="size-2.5 rounded-full bg-zinc-800 ring-2 ring-white group-hover:size-3 group-focus-visible:size-3" />
                    <span
                      role="tooltip"
                      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-[11px] whitespace-nowrap text-zinc-600 shadow group-hover:block group-focus-visible:block"
                    >
                      <strong className="block text-[13px] text-zinc-900">{p.valueLabel}</strong>
                      {p.caption}
                    </span>
                  </li>
                ),
              )}
            </ol>
          </div>
          <div className="relative mx-1.5 mt-1 h-3 text-[10px] text-zinc-500" aria-hidden>
            {points.map((p, i) =>
              i % tickEvery === 0 || (i === n - 1 && (n - 1) % tickEvery >= tickEvery / 2) ? (
                <span key={p.key} className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${x(i)}%` }}>
                  {p.tick ?? p.key}
                </span>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </figure>
  );
}
