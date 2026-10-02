/** Number formatting shared by report views. */
export const nf = new Intl.NumberFormat("en-CA");

export function pct(v: number | null | undefined, digits = 0) {
  if (v == null || Number.isNaN(v)) return "—";
  return `${(v * 100).toFixed(digits)}%`;
}

export function daysLabel(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  const n = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n} ${n === 1 ? "day" : "days"}`;
}

export function hoursLabel(v: number | null | undefined) {
  if (v == null || Number.isNaN(v)) return "—";
  return v < 48 ? `${Math.round(v)}h` : `${Math.round(v / 24)}d`;
}

/** Ratio as a share, guarding against divide-by-zero. */
export const ratio = (a: number, b: number) => (b ? a / b : null);

/** Clean axis ticks: a 1/2/5 × 10^n step, about four intervals, whole numbers only. */
export function niceTicks(v: number, intervals = 4) {
  const raw = Math.max(1, v) / intervals;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(1, ([1, 2, 5, 10].find((m) => m * p >= raw) ?? 10) * p);
  const max = Math.max(step, Math.ceil(v / step) * step);
  return { max, ticks: Array.from({ length: Math.round(max / step) + 1 }, (_, i) => i * step) };
}
