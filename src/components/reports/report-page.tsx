import { BarChart3 } from "lucide-react";
import { canViewReports, canViewTeamAnalytics, type UserActor } from "@/server/policy";
import { filtersToParams, resolveFilters, type ReportFilters } from "@/server/services/reports/filters";
import { getReportFilterOptions } from "@/server/services/reports/options";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { EmptyState } from "@/components/ui/card";
import { ReportFrame } from "./filter-bar";

export type ReportTab = "overview" | "pipeline" | "snapshot" | "velocity" | "sources" | "offers" | "headcount" | "team" | "builder" | "saved";

const TABS: { key: ReportTab; label: string; path: string; team?: boolean }[] = [
  { key: "overview", label: "Overview", path: "/reports" },
  { key: "pipeline", label: "Pipeline", path: "/reports/pipeline" },
  { key: "snapshot", label: "Snapshot", path: "/reports/snapshot" },
  { key: "velocity", label: "Velocity", path: "/reports/velocity" },
  { key: "sources", label: "Sources", path: "/reports/sources" },
  { key: "offers", label: "Offers", path: "/reports/offers" },
  { key: "headcount", label: "Headcount", path: "/reports/headcount" },
  { key: "team", label: "Team", path: "/reports/team", team: true },
  { key: "builder", label: "Builder", path: "/reports/builder" },
  { key: "saved", label: "Saved", path: "/reports/saved" },
];

export function qs(params: Record<string, string | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Drill-down link carrying the current filters. */
export function drillHref(f: ReportFilters, set: Record<string, string>) {
  return `/reports/records${qs({ ...filtersToParams(f), ...set })}`;
}

export function NoReportAccess({ team = false }: { team?: boolean }) {
  return (
    <>
      <PageHeader title="Reports" />
      <EmptyState
        icon={<BarChart3 size={28} />}
        title={team ? "Team analytics are for the recruiting team" : "Reports aren't available for your role"}
        description={team ? "They rate named colleagues, so they're limited to recruiters, coordinators, admins and executives." : "Ask a recruiter or admin if you need numbers for a job you're hiring for."}
      />
    </>
  );
}

/** Resolves filters from the URL for a report page. Null when the actor may not see reports. */
export function reportFilters(actor: UserActor, sp: Record<string, string | string[] | undefined>) {
  if (!canViewReports(actor)) return null;
  return resolveFilters(actor, sp as Record<string, unknown>);
}

export async function ReportShell({
  actor,
  tab,
  filters,
  subtitle,
  extra,
  children,
}: {
  actor: UserActor;
  tab: ReportTab;
  filters: ReportFilters;
  subtitle?: string;
  /** Page-specific params kept when filters change (e.g. the drill-down set). */
  extra?: Record<string, string>;
  children: React.ReactNode;
}) {
  const options = await getReportFilterOptions(actor);
  const params = filtersToParams(filters);
  const tabs = TABS.filter((t) => !t.team || canViewTeamAnalytics(actor));
  return (
    <>
      <PageHeader title="Reports" subtitle={subtitle ?? "Numbers cover only the jobs you can see."}>
        <FilterTabs active={tab} tabs={tabs.map((t) => ({ key: t.key, label: t.label }))} hrefFor={(k) => `${tabs.find((t) => t.key === k)!.path}${qs(params)}`} />
      </PageHeader>
      <ReportFrame
        value={{ range: filters.range, from: filters.fromDay, to: filters.toDay, brandId: filters.brandId, departmentId: filters.departmentId, jobId: filters.jobId }}
        options={options}
        extra={extra}
      >
        <div className="space-y-4 px-6 py-4">{children}</div>
      </ReportFrame>
    </>
  );
}
