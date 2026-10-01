import { sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DEFAULT_STAGES } from "@/lib/stages";

type Role = (typeof s.userRole.enumValues)[number];
let n = 0;
const uid = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

/** Empties every application table (keeps the migrations journal). */
export async function resetDb() {
  const { rows } = await db.execute<{ tablename: string }>(sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`);
  if (rows.length === 0) return;
  await db.execute(sql.raw(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`));
}

export async function makeUser(role: Role, name = `${role} ${uid()}`) {
  const [u] = await db.insert(s.users).values({ email: `${uid()}@test.local`, name, role }).returning();
  return u;
}

export async function makeBrand() {
  const [b] = await db.insert(s.brands).values({ name: "Test Brand", slug: `brand-${uid()}` }).returning();
  return b;
}

export async function makeJob(opts: {
  brandId?: string;
  confidential?: boolean;
  hiringManagerId?: string;
  recruiterId?: string;
  coordinatorId?: string;
  team?: string[];
  title?: string;
}) {
  const brandId = opts.brandId ?? (await makeBrand()).id;
  const [job] = await db
    .insert(s.jobs)
    .values({
      title: opts.title ?? `Job ${uid()}`,
      brandId,
      status: "open",
      confidential: opts.confidential ?? false,
      hiringManagerId: opts.hiringManagerId,
      recruiterId: opts.recruiterId,
      coordinatorId: opts.coordinatorId,
    })
    .returning();
  const stages = await db
    .insert(s.jobStages)
    .values(DEFAULT_STAGES.map((st, i) => ({ jobId: job.id, name: st.name, type: st.type, position: i })))
    .returning();
  if (opts.team?.length) await db.insert(s.jobHiringTeam).values(opts.team.map((userId) => ({ jobId: job.id, userId })));
  return { job, stages: stages.sort((a, b) => a.position - b.position) };
}

export async function makeCandidate(overrides: Partial<typeof s.candidates.$inferInsert> = {}) {
  const [c] = await db
    .insert(s.candidates)
    .values({ firstName: "Test", lastName: `Candidate ${uid()}`, email: `${uid()}@candidate.test`, ...overrides })
    .returning();
  return c;
}

export async function makeApplication(candidateId: string, job: { job: { id: string }; stages: { id: string }[] }) {
  const [a] = await db.insert(s.applications).values({ candidateId, jobId: job.job.id, stageId: job.stages[0].id }).returning();
  return a;
}
