import { CircleHelp } from "lucide-react";
import { METRICS, type MetricKey } from "@/server/services/reports/metrics";

/** "How is this measured?": the metric's written definition on hover or keyboard focus. */
export function Definition({ metric }: { metric: MetricKey }) {
  const m = METRICS[metric];
  return (
    <span className="group relative z-10 inline-flex align-middle">
      <button type="button" aria-label={`How ${m.label.toLowerCase()} is measured`} className="rounded text-zinc-400 hover:text-zinc-700 focus-visible:text-zinc-700">
        <CircleHelp size={13} />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute top-5 left-1/2 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-zinc-200 bg-white p-2.5 text-left text-xs leading-snug font-normal text-zinc-700 shadow-lg group-focus-within:block group-hover:block"
      >
        <span className="mb-0.5 block font-semibold text-zinc-900">{m.label}</span>
        {m.definition}
      </span>
    </span>
  );
}
