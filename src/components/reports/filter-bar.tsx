"use client";

import { createContext, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

type Options = { brands: { id: string; name: string }[]; departments: { id: string; name: string }[]; jobs: { id: string; title: string; brand: string }[] };
type Value = { range: string; from: string; to: string; brandId?: string; departmentId?: string; jobId?: string };

const PRESETS: { key: string; label: string }[] = [
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "180d", label: "Last 6 months" },
  { key: "365d", label: "Last 12 months" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];

const PendingContext = createContext(false);

const selectClass =
  "rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

/**
 * One filter row above every report (date range first). Changing a filter updates the URL, so
 * links, drill-downs and exports carry the same slice; the previous render stays (dimmed) while
 * the new one loads.
 */
export function ReportFrame({ value, options, extra, children }: { value: Value; options: Options; extra?: Record<string, string>; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  function update(patch: Partial<Value>) {
    const next = { ...value, ...patch };
    const p = new URLSearchParams(extra);
    p.set("range", next.range);
    if (next.range === "custom") {
      p.set("from", next.from);
      p.set("to", next.to);
    }
    for (const k of ["brandId", "departmentId", "jobId"] as const) if (next[k]) p.set(k, next[k]!);
    start(() => router.push(`${pathname}?${p.toString()}`));
  }

  return (
    <PendingContext value={pending}>
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 bg-white px-6 py-2.5" role="group" aria-label="Report filters">
        <select aria-label="Date range" className={selectClass} value={value.range} onChange={(e) => update({ range: e.target.value })}>
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
        {value.range === "custom" && (
          <>
            <input type="date" aria-label="From" className={selectClass} value={value.from} max={value.to} onChange={(e) => e.target.value && update({ from: e.target.value })} />
            <span className="text-xs text-zinc-500">to</span>
            <input type="date" aria-label="To" className={selectClass} value={value.to} min={value.from} onChange={(e) => e.target.value && update({ to: e.target.value })} />
          </>
        )}
        {value.range !== "custom" && (
          <span className="text-xs text-zinc-500 tabular-nums">
            {value.from} → {value.to}
          </span>
        )}
        <span className="mx-1 h-4 w-px bg-zinc-200" aria-hidden />
        <select aria-label="Brand" className={selectClass} value={value.brandId ?? ""} onChange={(e) => update({ brandId: e.target.value || undefined, jobId: undefined })}>
          <option value="">All brands</option>
          {options.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <select aria-label="Department" className={selectClass} value={value.departmentId ?? ""} onChange={(e) => update({ departmentId: e.target.value || undefined, jobId: undefined })}>
          <option value="">All departments</option>
          {options.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select aria-label="Job" className={cn(selectClass, "max-w-64")} value={value.jobId ?? ""} onChange={(e) => update({ jobId: e.target.value || undefined })}>
          <option value="">All jobs</option>
          {options.jobs.map((j) => (
            <option key={j.id} value={j.id}>
              {j.title} · {j.brand}
            </option>
          ))}
        </select>
        {(value.brandId || value.departmentId || value.jobId) && (
          <button type="button" className="text-xs font-medium text-zinc-600 underline-offset-2 hover:underline" onClick={() => update({ brandId: undefined, departmentId: undefined, jobId: undefined })}>
            Clear
          </button>
        )}
      </div>
      <div className={cn("transition-opacity", pending && "opacity-50")} aria-busy={pending}>
        {children}
      </div>
    </PendingContext>
  );
}

