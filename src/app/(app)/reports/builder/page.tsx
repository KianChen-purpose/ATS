import { requireActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { builderCatalogue, decodeDefinition, encodeDefinition, runReport, type ReportResult } from "@/server/services/reports/builder";
import { filtersToParams } from "@/server/services/reports/filters";
import { getSavedReport, shareablePeople } from "@/server/services/reports/saved";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { BuilderControls } from "@/components/reports/builder-controls";
import { ResultView } from "@/components/reports/result-view";
import { SaveReportButton } from "@/components/reports/save-report";
import { NoReportAccess, ReportShell, qs, reportFilters } from "@/components/reports/report-page";

export const metadata = { title: "Report builder" };

export default async function BuilderPage(props: PageProps<"/reports/builder">) {
  const actor = await requireActor();
  const sp = await props.searchParams;
  const f = reportFilters(actor, sp);
  if (!f) return <NoReportAccess />;
  const def = decodeDefinition(typeof sp.q === "string" ? sp.q : null);
  const q = encodeDefinition(def);

  let editing: Awaited<ReturnType<typeof getSavedReport>> | null = null;
  if (typeof sp.edit === "string") {
    try {
      const r = await getSavedReport(actor, sp.edit);
      if (r.canEdit) editing = r;
    } catch (e) {
      if (!(e instanceof NotFoundError)) throw e;
    }
  }

  let result: ReportResult | null = null;
  let blocked: string | null = null;
  try {
    result = await runReport(actor, def, f);
  } catch (e) {
    if (e instanceof ForbiddenError) blocked = e.message;
    else throw e;
  }
  const params = filtersToParams(f);
  const recordsHref = (keys: (string | null)[]) => `/reports/builder/records${qs({ ...params, q, k: JSON.stringify(keys.map((k) => k ?? "∅")) })}`;
  const people = await shareablePeople(actor);

  return (
    <ReportShell actor={actor} tab="builder" filters={f} extra={{ q, ...(editing ? { edit: editing.id } : {}) }} subtitle={editing ? `Editing “${editing.name}”` : "Build your own report. Numbers cover only the jobs you can see."}>
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="h-fit p-4">
          <BuilderControls catalogue={builderCatalogue(actor)} definition={def} filterParams={params} />
        </Card>
        <Card className="min-w-0 overflow-hidden">
          <CardHeader
            title={result ? `${result.dataset.label}${def.groupBy.length ? ` by ${result.columns.filter((c) => c.kind === "dimension").map((c) => c.label.toLowerCase()).join(" and ")}` : ""}` : "Report"}
            action={
              <SaveReportButton
                definition={def}
                filters={params}
                people={people}
                editing={editing ? { id: editing.id, name: editing.name, description: editing.description, visibility: editing.visibility, shareWith: editing.sharedWith.map((u) => u.id) } : null}
              />
            }
          />
          {blocked ? <EmptyState title="Not available" description={blocked} /> : result && <ResultView result={result} recordsHref={recordsHref} />}
        </Card>
      </div>
    </ReportShell>
  );
}
