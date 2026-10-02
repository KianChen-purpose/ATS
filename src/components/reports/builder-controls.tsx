"use client";

import { useOptimistic, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BarChart3, LineChart, Rows3, Table2, X } from "lucide-react";
import type { BuilderCatalogue, ReportDefinition } from "@/server/services/reports/builder";
import { builderDimensionValues } from "@/server/actions/reports";
import { encodeReportDefinition } from "@/lib/report-definition";
import { cn } from "@/lib/utils";

const NONE = "∅";
const selectClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-[13px] outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
const sectionLabel = "mb-1 block text-xs font-medium text-zinc-600";

const VIZ = [
  { key: "table", label: "Table", icon: Table2 },
  { key: "bar", label: "Bars", icon: BarChart3 },
  { key: "line", label: "Line", icon: LineChart },
  { key: "pivot", label: "Pivot", icon: Rows3 },
] as const;

/**
 * The builder's left panel. Every change rewrites ?q= (the definition) so the result re-renders on
 * the server, and the URL is a shareable link to exactly this report.
 */
export function BuilderControls({ catalogue, definition: saved, filterParams }: { catalogue: BuilderCatalogue; definition: ReportDefinition; filterParams: Record<string, string> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  // Controls reflect a change immediately; the server result follows.
  const [definition, setDefinition] = useOptimistic(saved);
  const [valuesFor, setValuesFor] = useState<string | null>(null);
  const [values, setValues] = useState<string[]>([]);
  const [valuesError, setValuesError] = useState<string | null>(null);
  const [loadingValues, startValues] = useTransition();

  const ds = catalogue.find((d) => d.key === definition.dataset) ?? catalogue[0];
  const firstDim = ds.dimensions.find((d) => d.key === definition.groupBy[0]);

  function update(next: Partial<ReportDefinition>) {
    const def = { ...definition, ...next };
    const p = new URLSearchParams(params.toString());
    p.set("q", encodeReportDefinition(def));
    start(() => {
      setDefinition(def);
      router.push(`${pathname}?${p.toString()}`);
    });
  }

  function changeDataset(key: string) {
    const next = catalogue.find((d) => d.key === key)!;
    const dim = next.dimensions.find((d) => d.key === definition.groupBy[0]) ? definition.groupBy[0] : next.dimensions.find((d) => !d.time)?.key;
    update({ dataset: key, dateField: next.dateFields[0].key, groupBy: dim ? [dim] : [], metrics: [next.metrics[0].key], filters: [] });
    setValuesFor(null);
  }

  function setGroup(i: 0 | 1, key: string) {
    const g = [...definition.groupBy];
    if (key === "") g.splice(i, 1);
    else g[i] = key;
    const groupBy = [...new Set(g.filter(Boolean))];
    const nextFirst = ds.dimensions.find((d) => d.key === groupBy[0]);
    let visualization = definition.visualization;
    if (groupBy.length === 2 && visualization === "line") visualization = "pivot";
    if (groupBy.length === 1 && nextFirst?.time && visualization === "bar") visualization = "line";
    if (groupBy.length < 2 && visualization === "pivot") visualization = "bar";
    update({ groupBy, visualization });
  }

  function toggleMetric(key: string) {
    const has = definition.metrics.includes(key);
    const metrics = has ? definition.metrics.filter((m) => m !== key) : [...definition.metrics, key].slice(0, 4);
    if (metrics.length) update({ metrics });
  }

  function openFilter(dim: string) {
    setValuesFor(dim);
    setValues([]);
    setValuesError(null);
    startValues(async () => {
      const r = await builderDimensionValues({ ...definition, filters: [] }, dim, filterParams);
      if ("error" in r) setValuesError(r.error);
      else setValues(r);
    });
  }

  function toggleFilterValue(dim: string, v: string) {
    const current = definition.filters.find((f) => f.dimension === dim)?.values ?? [];
    const nextValues = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
    const others = definition.filters.filter((f) => f.dimension !== dim);
    update({ filters: nextValues.length ? [...others, { dimension: dim, values: nextValues }] : others });
  }

  const vizAllowed = (k: string) =>
    k === "table" ||
    (k === "bar" && definition.groupBy.length > 0) ||
    (k === "line" && definition.groupBy.length === 1 && !!firstDim?.time) ||
    (k === "pivot" && definition.groupBy.length === 2);
  const dimLabel = (k: string) => ds.dimensions.find((d) => d.key === k)?.label ?? k;

  return (
    <div className={cn("space-y-4 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <label className="block">
        <span className={sectionLabel}>Dataset</span>
        <select className={selectClass} value={ds.key} onChange={(e) => changeDataset(e.target.value)}>
          {catalogue.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-zinc-500">{ds.description}</span>
      </label>

      <label className="block">
        <span className={sectionLabel}>Date range applies to</span>
        <select className={selectClass} value={definition.dateField} onChange={(e) => update({ dateField: e.target.value })}>
          {ds.dateFields.map((d) => (
            <option key={d.key} value={d.key}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <div>
        <span className={sectionLabel}>Group by</span>
        <div className="space-y-1.5">
          {[0, 1].map((i) => (
            <select
              key={i}
              aria-label={i === 0 ? "Group by" : "Then by"}
              className={selectClass}
              value={definition.groupBy[i] ?? ""}
              disabled={i === 1 && definition.groupBy.length === 0}
              onChange={(e) => setGroup(i as 0 | 1, e.target.value)}
            >
              <option value="">{i === 0 ? "No grouping (one total)" : "Then by… (optional)"}</option>
              {ds.dimensions
                .filter((d) => d.key !== definition.groupBy[i === 0 ? 1 : 0])
                .map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.label}
                  </option>
                ))}
            </select>
          ))}
        </div>
      </div>

      <fieldset>
        <legend className={sectionLabel}>Metrics (up to 4)</legend>
        <div className="space-y-1">
          {ds.metrics.map((m) => (
            <label key={m.key} className="flex items-start gap-2 text-[13px]" title={m.description}>
              <input
                type="checkbox"
                className="mt-0.5"
                checked={definition.metrics.includes(m.key)}
                disabled={!definition.metrics.includes(m.key) && definition.metrics.length >= 4}
                onChange={() => toggleMetric(m.key)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <span className={sectionLabel}>Filters</span>
        {definition.filters.length > 0 && (
          <ul className="mb-2 space-y-1">
            {definition.filters.map((f) => (
              <li key={f.dimension} className="flex items-start justify-between gap-2 rounded-md bg-zinc-100 px-2 py-1 text-xs">
                <span>
                  <span className="font-medium">{dimLabel(f.dimension)}:</span> {f.values.map((v) => (v === NONE ? "(none)" : v)).join(", ")}
                </span>
                <button type="button" aria-label={`Remove ${dimLabel(f.dimension)} filter`} className="text-zinc-500 hover:text-zinc-900" onClick={() => update({ filters: definition.filters.filter((x) => x.dimension !== f.dimension) })}>
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <select aria-label="Add a filter" className={selectClass} value={valuesFor ?? ""} onChange={(e) => (e.target.value ? openFilter(e.target.value) : setValuesFor(null))}>
          <option value="">Add a filter…</option>
          {ds.dimensions
            .filter((d) => !d.time)
            .map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
        </select>
        {valuesFor && (
          <div className="mt-1.5 max-h-48 overflow-y-auto rounded-md border border-zinc-200 bg-white p-2">
            {loadingValues && <p className="text-xs text-zinc-500">Loading values…</p>}
            {valuesError && <p className="text-xs text-red-700">{valuesError}</p>}
            {!loadingValues && !valuesError && values.length === 0 && <p className="text-xs text-zinc-500">No values in this range.</p>}
            {values.map((v) => {
              const checked = definition.filters.find((f) => f.dimension === valuesFor)?.values.includes(v) ?? false;
              return (
                <label key={v} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <input type="checkbox" checked={checked} onChange={() => toggleFilterValue(valuesFor, v)} />
                  {v === NONE ? "(none)" : v}
                </label>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <span className={sectionLabel}>Show as</span>
        <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Visualization">
          {VIZ.map((v) => {
            const allowed = vizAllowed(v.key);
            const active = definition.visualization === v.key;
            return (
              <button
                key={v.key}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={!allowed}
                title={allowed ? v.label : v.key === "line" ? "Group by one time bucket (week, month, quarter)" : v.key === "pivot" ? "Group by two dimensions" : "Add a group-by"}
                onClick={() => update({ visualization: v.key })}
                className={cn(
                  "flex flex-col items-center gap-0.5 rounded-md border px-1 py-1.5 text-[11px] font-medium",
                  active ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-400",
                  !allowed && "cursor-not-allowed opacity-40 hover:border-zinc-200",
                )}
              >
                <v.icon size={15} />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
