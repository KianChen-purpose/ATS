import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { encodeDefinition, runReport, validateDefinition } from "@/server/services/reports/builder";
import { filtersToParams } from "@/server/services/reports/filters";
import { getDashboard } from "@/server/services/reports/saved";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { ResultView } from "@/components/reports/result-view";
import { DeleteButton, TileControls } from "@/components/reports/saved-actions";
import { NoReportAccess, ReportShell, qs, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Dashboard" };

const VIS: Record<string, string> = { private: "Only the owner", people: "Shared with specific people", everyone: "Everyone who can open reports" };

/** A dashboard: saved reports as tiles, all under one filter row. */
export default async function DashboardPage(props: PageProps<"/reports/dashboards/[id]">) {
  const actor = await requireActor();
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams]);
  const f = reportFilters(actor, sp);
  if (!f) return <NoReportAccess />;
  let dash: Awaited<ReturnType<typeof getDashboard>>;
  try {
    dash = await getDashboard(actor, id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const params = filtersToParams(f);
  const tiles = await Promise.all(
    dash.items.map(async (item) => {
      const def = validateDefinition(item.definition);
      try {
        return { item, def, result: await runReport(actor, def, f), blocked: null as string | null };
      } catch (e) {
        if (e instanceof ForbiddenError) return { item, def, result: null, blocked: e.message };
        throw e;
      }
    }),
  );
  const editable = { id: dash.id, name: dash.name, description: dash.description, visibility: dash.visibility, shareWith: dash.sharedWith.map((u) => u.id), reportIds: dash.items.map((i) => i.reportId) };

  return (
    <ReportShell actor={actor} tab="saved" filters={f} subtitle={`Dashboard by ${dash.owner.name} · ${VIS[dash.visibility]} · the filters above apply to every tile`}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">{dash.name}</h2>
        {dash.canEdit && <DeleteButton kind="dashboard" id={dash.id} name={dash.name} />}
      </div>
      {tiles.length === 0 ? (
        <Card>
          <EmptyState title="No tiles yet" description="Open a saved report and choose “Add to dashboard”." />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {tiles.map(({ item, def, result, blocked }, i) => {
            const q = encodeDefinition(def);
            return (
              <Card key={item.reportId} className="min-w-0 overflow-hidden">
                <CardHeader
                  title={
                    <Link href={`/reports/saved/${item.reportId}${qs(params)}`} className="hover:underline">
                      {item.name}
                    </Link>
                  }
                  action={dash.canEdit ? <TileControls dashboard={editable} index={i} /> : undefined}
                />
                {blocked ? (
                  <EmptyState title="Not available" description={blocked} />
                ) : (
                  result && <ResultView compact result={result} recordsHref={(keys) => `/reports/builder/records${qs({ ...params, q, k: JSON.stringify(keys.map((k) => k ?? "∅")), from: `/reports/dashboards/${dash.id}` })}`} />
                )}
              </Card>
            );
          })}
        </div>
      )}
      {dash.hiddenTiles > 0 && <p className="text-xs text-zinc-500">{dash.hiddenTiles} tile(s) use reports you don&apos;t have access to and are hidden.</p>}
    </ReportShell>
  );
}
