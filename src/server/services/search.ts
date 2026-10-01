import "server-only";
import { desc, ilike, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { UserActor } from "@/server/policy";

export type SearchResult = {
  candidates: { id: string; name: string; subtitle: string }[];
  jobs: { id: string; title: string; subtitle: string }[];
};

/** Global search used by the command palette (Cmd/Ctrl+K). */
export async function searchEverything(actor: UserActor, q: string): Promise<SearchResult> {
  void actor;
  const term = q.trim();
  if (term.length < 2) return { candidates: [], jobs: [] };
  const like = `%${term}%`;

  const [cands, jobs] = await Promise.all([
    db
      .select({
        id: schema.candidates.id,
        firstName: schema.candidates.firstName,
        lastName: schema.candidates.lastName,
        currentTitle: schema.candidates.currentTitle,
        currentCompany: schema.candidates.currentCompany,
      })
      .from(schema.candidates)
      .where(
        or(
          sql`(${schema.candidates.firstName} || ' ' || ${schema.candidates.lastName}) ILIKE ${like}`,
          ilike(schema.candidates.email, like),
          ilike(schema.candidates.currentCompany, like),
          ilike(schema.candidates.currentTitle, like),
          sql`array_to_string(${schema.candidates.tags}, ' ') ILIKE ${like}`,
        ),
      )
      .orderBy(desc(schema.candidates.updatedAt))
      .limit(8),
    db
      .select({ id: schema.jobs.id, title: schema.jobs.title, status: schema.jobs.status, brand: schema.brands.name })
      .from(schema.jobs)
      .innerJoin(schema.brands, sql`${schema.brands.id} = ${schema.jobs.brandId}`)
      .where(ilike(schema.jobs.title, like))
      .limit(5),
  ]);

  return {
    candidates: cands.map((c) => ({
      id: c.id,
      name: `${c.firstName} ${c.lastName}`,
      subtitle: [c.currentTitle, c.currentCompany].filter(Boolean).join(" at "),
    })),
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, subtitle: `${j.brand} · ${j.status.replace("_", " ")}` })),
  };
}
