import "server-only";
import { searchIndex, type SearchScope } from "@/server/integrations/search";
import { canSeeProspects, visibleJobIds, visibleJobsFilter, type UserActor } from "@/server/policy";

export type SearchResult = {
  candidates: { id: string; name: string; subtitle: string }[];
  jobs: { id: string; title: string; subtitle: string }[];
};

export function searchScope(actor: UserActor): SearchScope {
  return {
    visibleJobIds: visibleJobsFilter(actor) ? visibleJobIds(actor).getSQL() : undefined,
    includeProspects: canSeeProspects(actor),
  };
}

/** Global search used by the command palette (Cmd/Ctrl+K). Permission-trimmed via the scope. */
export async function searchEverything(actor: UserActor, q: string): Promise<SearchResult> {
  const term = q.trim();
  if (term.length < 2) return { candidates: [], jobs: [] };
  const scope = searchScope(actor);
  const [cands, jobs] = await Promise.all([searchIndex().candidates(term, scope, 8), searchIndex().jobs(term, scope, 5)]);
  return {
    candidates: cands.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      subtitle: [c.currentTitle, c.currentCompany].filter(Boolean).join(" at "),
    })),
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, subtitle: `${j.brand} · ${j.status.replace("_", " ")}` })),
  };
}
