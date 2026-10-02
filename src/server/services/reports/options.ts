import "server-only";
import { sql } from "drizzle-orm";
import { reportingDb } from "@/db/reporting";
import { visibleJobIds, type UserActor } from "@/server/policy";
import { assertCanViewReports } from "./standard";

/** Choices for the report filter row: only brands, departments and jobs the actor can see. */
export async function getReportFilterOptions(actor: UserActor) {
  assertCanViewReports(actor);
  const jobs = (
    await reportingDb.execute(sql`
      SELECT j.id, j.title, j.status::text AS status, j.brand_id, j.department_id, b.name AS brand
      FROM jobs j JOIN brands b ON b.id = j.brand_id
      WHERE j.id IN (${visibleJobIds(actor)})
      ORDER BY j.title`)
  ).rows as { id: string; title: string; status: string; brand_id: string; department_id: string | null; brand: string }[];
  const brandIds = [...new Set(jobs.map((j) => j.brand_id))];
  const deptIds = [...new Set(jobs.map((j) => j.department_id).filter((d): d is string => !!d))];
  const [brands, departments] = await Promise.all([
    brandIds.length
      ? reportingDb.execute(sql`SELECT id, name FROM brands WHERE id IN (${sql.join(brandIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY name`)
      : Promise.resolve({ rows: [] }),
    deptIds.length
      ? reportingDb.execute(sql`SELECT id, name FROM departments WHERE id IN (${sql.join(deptIds.map((id) => sql`${id}`), sql`, `)}) ORDER BY name`)
      : Promise.resolve({ rows: [] }),
  ]);
  return {
    brands: brands.rows as { id: string; name: string }[],
    departments: departments.rows as { id: string; name: string }[],
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, brand: j.brand, status: j.status })),
  };
}
