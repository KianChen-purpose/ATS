import "server-only";
import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";

/**
 * SearchIndex port (ARCHITECTURE.md D8). Postgres ILIKE today; Azure AI Search later behind the
 * same interface. Every query takes a visibility scope, so results are always permission-trimmed.
 */
export type SearchScope = {
  /** Subquery returning the ids of jobs the caller may see (or undefined for all jobs). */
  visibleJobIds: SQL | undefined;
  /** Whether candidates with no applications (sourced prospects) may be returned. */
  includeProspects: boolean;
};

export type CandidateHit = { id: string; firstName: string; lastName: string; currentTitle: string | null; currentCompany: string | null };
export type JobHit = { id: string; title: string; status: string; brand: string };

export interface SearchIndex {
  candidates(term: string, scope: SearchScope, limit: number): Promise<CandidateHit[]>;
  jobs(term: string, scope: SearchScope, limit: number): Promise<JobHit[]>;
  /** SQL predicate over `candidates` for list pages that combine text search with other filters. */
  candidateTextFilter(term: string, opts?: { includeResume?: boolean }): SQL;
}

function candidateTextFilter(term: string, opts: { includeResume?: boolean } = {}): SQL {
  const like = `%${term}%`;
  return or(
    sql`(${s.candidates.firstName} || ' ' || ${s.candidates.lastName}) ILIKE ${like}`,
    ilike(s.candidates.email, like),
    ilike(s.candidates.currentCompany, like),
    ilike(s.candidates.currentTitle, like),
    sql`array_to_string(${s.candidates.tags}, ' ') ILIKE ${like}`,
    ...(opts.includeResume ? [ilike(s.candidates.resumeText, like)] : []),
  )!;
}

/** Candidates the scope can see: on a visible job, or (if allowed) with no applications at all. */
function candidateVisibility(scope: SearchScope): SQL | undefined {
  const candId = sql.raw(`"candidates"."id"`);
  const onVisibleJob = scope.visibleJobIds
    ? sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${candId} AND a.job_id IN (${scope.visibleJobIds}))`
    : sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${candId})`;
  const prospect = sql`NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${candId})`;
  return scope.includeProspects ? or(onVisibleJob, prospect) : onVisibleJob;
}

const postgresSearch: SearchIndex = {
  candidates(term, scope, limit) {
    return db
      .select({
        id: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        currentTitle: s.candidates.currentTitle,
        currentCompany: s.candidates.currentCompany,
      })
      .from(s.candidates)
      .where(and(candidateTextFilter(term), candidateVisibility(scope)))
      .orderBy(desc(s.candidates.updatedAt))
      .limit(limit);
  },
  jobs(term, scope, limit) {
    return db
      .select({ id: s.jobs.id, title: s.jobs.title, status: s.jobs.status, brand: s.brands.name })
      .from(s.jobs)
      .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
      .where(and(ilike(s.jobs.title, `%${term}%`), scope.visibleJobIds ? sql`${s.jobs.id} IN (${scope.visibleJobIds})` : undefined))
      .limit(limit);
  },
  candidateTextFilter,
};

export function searchIndex(): SearchIndex {
  return postgresSearch;
}
