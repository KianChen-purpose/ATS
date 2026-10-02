import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { searchIndex } from "@/server/integrations/search";
import { canSeeProspects, ForbiddenError, NotFoundError, requireUserActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";
import { assertCanSeeCandidate } from "./candidates";
import { searchScope } from "./search";

/**
 * Talent pools (PRD §4.2): lists of prospects not tied to a job. Pools are a sourcing tool for
 * the roles that can see prospects (ARCHITECTURE.md §3.3). Members who are only on jobs the
 * viewer can't see are left out of what the viewer gets back.
 */

function requireSourcer(actor: Actor) {
  const u = requireUserActor(actor);
  if (!canSeeProspects(u)) throw new ForbiddenError("Talent pools are for the recruiting team.");
  return u;
}

/** Candidates the actor may see: prospects (no applications) or on a visible job. */
function visibleCandidate(actor: UserActor) {
  const scope = searchScope(actor);
  const cand = sql.raw(`"talent_pool_members"."candidate_id"`);
  const onVisibleJob = scope.visibleJobIds
    ? sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${cand} AND a.job_id IN (${scope.visibleJobIds}))`
    : sql`EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${cand})`;
  return sql`(${onVisibleJob} OR NOT EXISTS (SELECT 1 FROM applications a WHERE a.candidate_id = ${cand}))`;
}

export const poolSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).optional().transform((v) => v || null),
  brandId: z.string().uuid().nullable().default(null),
});

export async function createPool(actor: Actor, d: z.output<typeof poolSchema>) {
  const user = requireSourcer(actor);
  return db.transaction(async (tx) => {
    const [pool] = await tx.insert(s.talentPools).values({ ...d, ownerId: user.id }).returning();
    await recordAudit(tx, actor, "talent_pool.created", "talent_pool", pool.id, { name: d.name });
    return pool;
  });
}

export async function listPools(actor: UserActor) {
  requireSourcer(actor);
  const pools = await db.query.talentPools.findMany({
    where: eq(s.talentPools.archived, false),
    orderBy: asc(s.talentPools.name),
    with: { brand: true, owner: true },
  });
  if (pools.length === 0) return [];
  const counts = await db
    .select({ poolId: s.talentPoolMembers.poolId, stage: s.talentPoolMembers.stage, n: sql<number>`count(*)::int` })
    .from(s.talentPoolMembers)
    .where(and(inArray(s.talentPoolMembers.poolId, pools.map((p) => p.id)), visibleCandidate(actor)))
    .groupBy(s.talentPoolMembers.poolId, s.talentPoolMembers.stage);
  return pools.map((p) => {
    const mine = counts.filter((c) => c.poolId === p.id);
    return { ...p, members: mine.reduce((n, c) => n + c.n, 0), byStage: Object.fromEntries(mine.map((c) => [c.stage, c.n])) as Record<string, number> };
  });
}

export async function getPool(actor: UserActor, poolId: string) {
  requireSourcer(actor);
  const pool = await db.query.talentPools.findFirst({ where: eq(s.talentPools.id, poolId), with: { brand: true, owner: true } });
  if (!pool) return null;
  const members = await db
    .select({
      candidateId: s.candidates.id,
      firstName: s.candidates.firstName,
      lastName: s.candidates.lastName,
      currentTitle: s.candidates.currentTitle,
      currentCompany: s.candidates.currentCompany,
      email: s.candidates.email,
      stage: s.talentPoolMembers.stage,
      addedAt: s.talentPoolMembers.addedAt,
      updatedAt: s.talentPoolMembers.updatedAt,
      addedBy: s.users.name,
      applications: sql<number>`(SELECT count(*)::int FROM applications a WHERE a.candidate_id = ${sql.raw('"candidates"."id"')})`,
      talentPoolConsent: sql<boolean>`EXISTS (
        SELECT 1 FROM consent_records cr WHERE cr.candidate_id = ${sql.raw('"candidates"."id"')} AND cr.purpose = 'talent_pool'
          AND cr.granted AND (cr.expires_at IS NULL OR cr.expires_at > now())
          AND cr.created_at = (SELECT max(c2.created_at) FROM consent_records c2 WHERE c2.candidate_id = cr.candidate_id AND c2.purpose = 'talent_pool'))`,
    })
    .from(s.talentPoolMembers)
    .innerJoin(s.candidates, eq(s.candidates.id, s.talentPoolMembers.candidateId))
    .leftJoin(s.users, eq(s.users.id, s.talentPoolMembers.addedById))
    .where(and(eq(s.talentPoolMembers.poolId, poolId), visibleCandidate(actor)))
    .orderBy(desc(s.talentPoolMembers.updatedAt));
  return { pool, members };
}

async function requirePool(poolId: string) {
  const pool = await db.query.talentPools.findFirst({ where: eq(s.talentPools.id, poolId) });
  if (!pool || pool.archived) throw new NotFoundError("Talent pool");
  return pool;
}

export async function addToPool(actor: Actor, poolId: string, candidateId: string) {
  const user = requireSourcer(actor);
  await requirePool(poolId);
  await assertCanSeeCandidate(user, candidateId);
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.talentPoolMembers).values({ poolId, candidateId, addedById: user.id }).onConflictDoNothing().returning();
    if (row) await recordAudit(tx, actor, "talent_pool.member_added", "talent_pool", poolId, { candidateId });
    return { added: Boolean(row) };
  });
}

export const prospectSchema = z.object({
  poolId: z.string().uuid(),
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(254).optional().or(z.literal("")).transform((v) => v || null),
  linkedinUrl: z.string().trim().url().max(300).optional().or(z.literal("")).transform((v) => v || null),
  currentTitle: z.string().trim().max(200).optional().transform((v) => v || null),
  currentCompany: z.string().trim().max(200).optional().transform((v) => v || null),
  note: z.string().trim().max(5000).optional().transform((v) => v || null),
});

/** Add a new prospect (a candidate with no application) straight into a pool. */
export async function createProspect(actor: Actor, d: z.output<typeof prospectSchema>) {
  const user = requireSourcer(actor);
  await requirePool(d.poolId);
  if (d.email) {
    const existing = await db.query.candidates.findFirst({ where: sql`lower(${s.candidates.email}) = ${d.email}` });
    if (existing) return { duplicateId: existing.id };
  }
  return db.transaction(async (tx) => {
    const [c] = await tx
      .insert(s.candidates)
      .values({ firstName: d.firstName, lastName: d.lastName, email: d.email, linkedinUrl: d.linkedinUrl, currentTitle: d.currentTitle, currentCompany: d.currentCompany, ownerId: user.id })
      .returning();
    await recordAudit(tx, actor, "candidate.created", "candidate", c.id, { via: "sourcing" });
    await tx.insert(s.talentPoolMembers).values({ poolId: d.poolId, candidateId: c.id, addedById: user.id });
    await recordAudit(tx, actor, "talent_pool.member_added", "talent_pool", d.poolId, { candidateId: c.id });
    await tx.insert(s.activities).values({ candidateId: c.id, type: "note", actorId: user.id, body: d.note ? `Sourced: ${d.note}` : "Sourced as a prospect" });
    return { candidateId: c.id };
  });
}

export const stageSchema = z.enum(s.prospectStage.enumValues);

export async function setProspectStage(actor: Actor, poolId: string, candidateId: string, stage: z.output<typeof stageSchema>) {
  const user = requireSourcer(actor);
  await assertCanSeeCandidate(user, candidateId);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .update(s.talentPoolMembers)
      .set({ stage, updatedAt: new Date() })
      .where(and(eq(s.talentPoolMembers.poolId, poolId), eq(s.talentPoolMembers.candidateId, candidateId)))
      .returning();
    if (!row) throw new NotFoundError("Pool member");
    await recordAudit(tx, actor, "talent_pool.member_stage_changed", "talent_pool", poolId, { candidateId, stage });
  });
}

export async function removeFromPool(actor: Actor, poolId: string, candidateId: string) {
  const user = requireSourcer(actor);
  await assertCanSeeCandidate(user, candidateId);
  await db.transaction(async (tx) => {
    const rows = await tx
      .delete(s.talentPoolMembers)
      .where(and(eq(s.talentPoolMembers.poolId, poolId), eq(s.talentPoolMembers.candidateId, candidateId)))
      .returning();
    if (rows.length) await recordAudit(tx, actor, "talent_pool.member_removed", "talent_pool", poolId, { candidateId });
  });
}

/** Candidates to add (not already in the pool), from the permission-trimmed search index. */
export async function searchForPool(actor: UserActor, poolId: string, q: string) {
  requireSourcer(actor);
  if (q.trim().length < 2) return [];
  const [hits, members] = await Promise.all([
    searchIndex().candidates(q.trim(), searchScope(actor), 25),
    db.select({ id: s.talentPoolMembers.candidateId }).from(s.talentPoolMembers).where(eq(s.talentPoolMembers.poolId, poolId)),
  ]);
  const inPool = new Set(members.map((m) => m.id));
  return hits.filter((h) => !inPool.has(h.id)).slice(0, 10);
}

/** When a pool member applies or is added to a job, mark them Applied everywhere (in the caller's tx). */
export async function markPoolMembersApplied(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], candidateId: string) {
  await tx.update(s.talentPoolMembers).set({ stage: "applied", updatedAt: new Date() }).where(eq(s.talentPoolMembers.candidateId, candidateId));
}
