import Link from "next/link";
import type { MetricKey } from "@/server/services/reports/metrics";
import { Definition } from "./definition";

export function StatTile({ label, value, sub, metric, href }: { label: string; value: string; sub?: string; metric?: MetricKey; href?: string }) {
  const body = (
    <>
      <div className="flex items-center gap-1 text-xs font-medium text-zinc-500">
        {label}
        {metric && <Definition metric={metric} />}
      </div>
      <div className="mt-1 text-2xl font-semibold text-zinc-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-zinc-500">{sub}</div>}
    </>
  );
  return (
    <div className="relative rounded-lg border border-zinc-200 bg-white px-4 py-3">
      {href ? (
        <>
          {body}
          <Link href={href} className="absolute inset-0 rounded-lg hover:bg-zinc-50/40 focus-visible:ring-2 focus-visible:ring-accent-500" aria-label={`${label}: see records`} />
        </>
      ) : (
        body
      )}
    </div>
  );
}

export function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}
