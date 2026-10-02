import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { reportingDb } from "@/db/reporting";
import { canViewCompensation, canViewReports, canViewTeamAnalytics, NotFoundError, userActor, visibleJobIds, type UserActor } from "@/server/policy";
import { recordAudit } from "../audit";
import { assertCanViewReports } from "./standard";

/**
 * Power BI / Excel OData v4 feed (PRD §7.3). A read-only, paged, flat view of the reporting data
 * for refreshable models. Authenticated with a personal access token and run as that token's user,
 * so the feed is trimmed to their jobs and fields exactly like the screens. The feed carries ids,
 * not names or contact details: candidates are pseudonymous (CandidateId) and person-level sets
 * follow the team-analytics rule. Every page read is audited as an export.
 */

export const FEED_PAGE_SIZE = 2000;
export const FEED_MAX_TOP = 5000;
const TOKEN_DAYS = { 30: 30, 90: 90, 180: 180, 365: 365 } as const;

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

export const feedTokenSchema = z.object({
  name: z.string().trim().min(2).max(80),
  days: z.coerce.number().refine((d) => d in TOKEN_DAYS, "Choose 30, 90, 180 or 365 days.").default(90),
});

export async function createFeedToken(actor: UserActor, input: z.input<typeof feedTokenSchema>) {
  assertCanViewReports(actor);
  const d = feedTokenSchema.parse(input);
  const token = `pats_${randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + d.days * 86_400_000);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.reportFeedTokens)
      .values({ userId: actor.id, name: d.name, tokenHash: sha256(token), prefix: token.slice(0, 10), expiresAt })
      .returning({ id: s.reportFeedTokens.id });
    await recordAudit(tx, actor, "feed_token.created", "report_feed_token", row.id, { name: d.name, expiresAt: expiresAt.toISOString() });
    // The only time the token itself is returned.
    return { id: row.id, token, expiresAt };
  });
}

export async function listFeedTokens(actor: UserActor) {
  assertCanViewReports(actor);
  return db
    .select({
      id: s.reportFeedTokens.id,
      name: s.reportFeedTokens.name,
      prefix: s.reportFeedTokens.prefix,
      createdAt: s.reportFeedTokens.createdAt,
      expiresAt: s.reportFeedTokens.expiresAt,
      lastUsedAt: s.reportFeedTokens.lastUsedAt,
      revokedAt: s.reportFeedTokens.revokedAt,
    })
    .from(s.reportFeedTokens)
    .where(eq(s.reportFeedTokens.userId, actor.id))
    .orderBy(desc(s.reportFeedTokens.createdAt));
}

export async function revokeFeedToken(actor: UserActor, id: string) {
  assertCanViewReports(actor);
  return db.transaction(async (tx) => {
    const t = await tx.query.reportFeedTokens.findFirst({ where: eq(s.reportFeedTokens.id, id) });
    if (!t || (t.userId !== actor.id && actor.role !== "admin")) throw new NotFoundError("Token");
    if (t.revokedAt) return;
    await tx.update(s.reportFeedTokens).set({ revokedAt: new Date() }).where(eq(s.reportFeedTokens.id, id));
    await recordAudit(tx, actor, "feed_token.revoked", "report_feed_token", id, { name: t.name });
  });
}

export class FeedAuthError extends Error {
  constructor() {
    super("A valid PATS feed token is required.");
    this.name = "FeedAuthError";
  }
}

/** Resolves a presented token to the user it acts as. Revoked, expired and inactive-user tokens fail. */
export async function authenticateFeedToken(token: string, request?: UserActor["request"]) {
  if (!/^pats_[A-Za-z0-9_-]{43}$/.test(token)) throw new FeedAuthError();
  const row = await db.query.reportFeedTokens.findFirst({
    where: and(eq(s.reportFeedTokens.tokenHash, sha256(token)), isNull(s.reportFeedTokens.revokedAt)),
    with: { user: true },
  });
  if (!row || row.expiresAt <= new Date() || !row.user.active) throw new FeedAuthError();
  const actor = userActor(row.user, request);
  if (!canViewReports(actor)) throw new FeedAuthError();
  // Touch at most every few minutes; refreshes page through many requests.
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
    await db.update(s.reportFeedTokens).set({ lastUsedAt: new Date() }).where(eq(s.reportFeedTokens.id, row.id));
  }
  return { actor, tokenId: row.id };
}

// ---------------------------------------------------------------------------
// Entity sets
// ---------------------------------------------------------------------------

type EdmType = "Edm.Guid" | "Edm.String" | "Edm.Int32" | "Edm.Double" | "Edm.Boolean" | "Edm.DateTimeOffset" | "Edm.Date";
type Property = { name: string; type: EdmType; sql: SQL; nullable?: boolean; compensation?: boolean };
type EntitySet = { name: string; type: string; from: (scope: SQL) => SQL; orderBy: SQL; properties: Property[]; person?: boolean };

const P = (name: string, type: EdmType, expr: SQL, opts: Partial<Property> = {}): Property => ({ name, type, sql: expr, nullable: true, ...opts });
const key = (name: string, expr: SQL) => P(name, "Edm.Guid", expr, { nullable: false });

const ENTITY_SETS: EntitySet[] = [
  {
    name: "Jobs",
    type: "Job",
    from: (scope) => sql`jobs j JOIN brands b ON b.id = j.brand_id LEFT JOIN departments d ON d.id = j.department_id LEFT JOIN locations loc ON loc.id = j.location_id WHERE j.id IN (${scope})`,
    orderBy: sql`j.id`,
    properties: [
      key("Id", sql`j.id`),
      P("Title", "Edm.String", sql`j.title`),
      P("Brand", "Edm.String", sql`b.name`),
      P("Department", "Edm.String", sql`d.name`),
      P("Location", "Edm.String", sql`loc.name`),
      P("Status", "Edm.String", sql`j.status::text`),
      P("EmploymentType", "Edm.String", sql`j.employment_type::text`),
      P("WorkplaceType", "Edm.String", sql`j.workplace_type::text`),
      P("Confidential", "Edm.Boolean", sql`j.confidential`),
      P("RecruiterId", "Edm.Guid", sql`j.recruiter_id`),
      P("HiringManagerId", "Edm.Guid", sql`j.hiring_manager_id`),
      P("CompMin", "Edm.Int32", sql`j.comp_min`, { compensation: true }),
      P("CompMax", "Edm.Int32", sql`j.comp_max`, { compensation: true }),
      P("Currency", "Edm.String", sql`j.currency`),
      P("CreatedAt", "Edm.DateTimeOffset", sql`j.created_at`),
      P("OpenedAt", "Edm.DateTimeOffset", sql`j.opened_at`),
      P("ClosedAt", "Edm.DateTimeOffset", sql`j.closed_at`),
    ],
  },
  {
    name: "Openings",
    type: "Opening",
    from: (scope) => sql`openings op WHERE op.job_id IN (${scope})`,
    orderBy: sql`op.id`,
    properties: [
      key("Id", sql`op.id`),
      P("JobId", "Edm.Guid", sql`op.job_id`, { nullable: false }),
      P("Code", "Edm.String", sql`op.code`),
      P("Status", "Edm.String", sql`op.status::text`),
      P("Reason", "Edm.String", sql`op.reason::text`),
      P("TargetStartDate", "Edm.Date", sql`op.target_start_date::text`),
      P("CreatedAt", "Edm.DateTimeOffset", sql`op.created_at`),
      P("FilledAt", "Edm.DateTimeOffset", sql`op.filled_at`),
    ],
  },
  {
    name: "Applications",
    type: "Application",
    from: (scope) => sql`applications a JOIN job_stages cs ON cs.id = a.stage_id LEFT JOIN sources src ON src.id = a.source_id LEFT JOIN archive_reasons ar ON ar.id = a.archive_reason_id WHERE a.job_id IN (${scope})`,
    orderBy: sql`a.id`,
    properties: [
      key("Id", sql`a.id`),
      P("CandidateId", "Edm.Guid", sql`a.candidate_id`, { nullable: false }),
      P("JobId", "Edm.Guid", sql`a.job_id`, { nullable: false }),
      P("Stage", "Edm.String", sql`cs.name`),
      P("StageType", "Edm.String", sql`cs.type::text`),
      P("Status", "Edm.String", sql`a.status::text`),
      P("Source", "Edm.String", sql`src.name`),
      P("SourceType", "Edm.String", sql`src.category::text`),
      P("ArchiveReason", "Edm.String", sql`ar.name`),
      P("AppliedAt", "Edm.DateTimeOffset", sql`a.applied_at`),
      P("StageEnteredAt", "Edm.DateTimeOffset", sql`a.stage_entered_at`),
      P("HiredAt", "Edm.DateTimeOffset", sql`a.hired_at`),
      P("ArchivedAt", "Edm.DateTimeOffset", sql`a.archived_at`),
    ],
  },
  {
    name: "StageEvents",
    type: "StageEvent",
    from: (scope) =>
      sql`application_stage_events e JOIN applications a ON a.id = e.application_id LEFT JOIN job_stages fs ON fs.id = e.from_stage_id LEFT JOIN job_stages ts ON ts.id = e.to_stage_id WHERE a.job_id IN (${scope})`,
    orderBy: sql`e.id`,
    properties: [
      key("Id", sql`e.id`),
      P("ApplicationId", "Edm.Guid", sql`e.application_id`, { nullable: false }),
      P("JobId", "Edm.Guid", sql`a.job_id`, { nullable: false }),
      P("FromStage", "Edm.String", sql`fs.name`),
      P("FromStageType", "Edm.String", sql`fs.type::text`),
      P("ToStage", "Edm.String", sql`ts.name`),
      P("ToStageType", "Edm.String", sql`ts.type::text`),
      P("Status", "Edm.String", sql`e.status::text`),
      P("CreatedAt", "Edm.DateTimeOffset", sql`e.created_at`),
    ],
  },
  {
    name: "Interviews",
    type: "Interview",
    from: (scope) => sql`interviews i JOIN applications a ON a.id = i.application_id LEFT JOIN job_stages ist ON ist.id = i.stage_id WHERE a.job_id IN (${scope})`,
    orderBy: sql`i.id`,
    properties: [
      key("Id", sql`i.id`),
      P("ApplicationId", "Edm.Guid", sql`i.application_id`, { nullable: false }),
      P("JobId", "Edm.Guid", sql`a.job_id`, { nullable: false }),
      P("Stage", "Edm.String", sql`ist.name`),
      P("StageType", "Edm.String", sql`ist.type::text`),
      P("Status", "Edm.String", sql`i.status::text`),
      P("StartAt", "Edm.DateTimeOffset", sql`i.start_at`),
      P("EndAt", "Edm.DateTimeOffset", sql`i.end_at`),
      P("Interviewers", "Edm.Int32", sql`(SELECT count(*)::int FROM interview_interviewers ii WHERE ii.interview_id = i.id)`),
      P("Scorecards", "Edm.Int32", sql`(SELECT count(*)::int FROM scorecards sc WHERE sc.interview_id = i.id)`),
    ],
  },
  {
    name: "Offers",
    type: "Offer",
    from: (scope) => sql`offers o JOIN applications a ON a.id = o.application_id WHERE a.job_id IN (${scope})`,
    orderBy: sql`o.id`,
    properties: [
      key("Id", sql`o.id`),
      P("ApplicationId", "Edm.Guid", sql`o.application_id`, { nullable: false }),
      P("JobId", "Edm.Guid", sql`a.job_id`, { nullable: false }),
      P("Status", "Edm.String", sql`o.status::text`),
      P("BaseSalary", "Edm.Int32", sql`o.base_salary`, { compensation: true }),
      P("BonusPercent", "Edm.Int32", sql`o.bonus_percent`, { compensation: true }),
      P("SignOnBonus", "Edm.Int32", sql`o.sign_on_bonus`, { compensation: true }),
      P("Currency", "Edm.String", sql`o.currency`),
      P("DeclineReason", "Edm.String", sql`o.decline_reason`),
      P("CreatedAt", "Edm.DateTimeOffset", sql`o.created_at`),
      P("SentAt", "Edm.DateTimeOffset", sql`o.sent_at`),
      P("DecidedAt", "Edm.DateTimeOffset", sql`o.decided_at`),
    ],
  },
  {
    name: "InterviewerAssignments",
    type: "InterviewerAssignment",
    person: true,
    from: (scope) =>
      sql`interview_interviewers ii JOIN interviews i ON i.id = ii.interview_id JOIN applications a ON a.id = i.application_id
        LEFT JOIN scorecards sc ON sc.interview_id = i.id AND sc.author_id = ii.user_id WHERE a.job_id IN (${scope})`,
    orderBy: sql`ii.interview_id, ii.user_id`,
    properties: [
      key("InterviewId", sql`ii.interview_id`),
      key("UserId", sql`ii.user_id`),
      P("JobId", "Edm.Guid", sql`a.job_id`, { nullable: false }),
      P("Recommendation", "Edm.String", sql`sc.overall::text`),
      P("SubmittedAt", "Edm.DateTimeOffset", sql`sc.submitted_at`),
    ],
  },
  {
    name: "People",
    type: "Person",
    person: true,
    from: () => sql`users u WHERE u.active`,
    orderBy: sql`u.id`,
    properties: [key("Id", sql`u.id`), P("Name", "Edm.String", sql`u.name`), P("Role", "Edm.String", sql`u.role::text`), P("Title", "Edm.String", sql`u.title`)],
  },
];

const KEYS: Record<string, string[]> = { InterviewerAssignments: ["InterviewId", "UserId"] };

/** The entity sets and properties this actor may read. */
export function feedCatalogue(actor: UserActor) {
  const comp = canViewCompensation(actor);
  const team = canViewTeamAnalytics(actor);
  return ENTITY_SETS.filter((e) => team || !e.person).map((e) => ({ ...e, properties: e.properties.filter((p) => comp || !p.compensation) }));
}

export class FeedQueryError extends Error {
  constructor(
    message: string,
    public status: 400 | 404 | 501 = 400,
  ) {
    super(message);
    this.name = "FeedQueryError";
  }
}

const SUPPORTED = new Set(["$top", "$skip", "$select", "$count", "$format"]);

/** One page of an entity set. Unsupported query options fail loudly rather than return unfiltered data. */
export async function readEntitySet(actor: UserActor, tokenId: string | null, name: string, query: Record<string, string>) {
  assertCanViewReports(actor);
  const set = feedCatalogue(actor).find((e) => e.name === name);
  if (!set) throw new FeedQueryError(`Unknown entity set "${name}".`, 404);
  for (const k of Object.keys(query)) {
    if (k.startsWith("$") && !SUPPORTED.has(k)) throw new FeedQueryError(`${k} isn't supported by this feed. Load the table and filter it in Power Query.`, 501);
  }
  if (query.$format && !/^json/.test(query.$format)) throw new FeedQueryError("Only JSON is supported.", 501);
  const top = query.$top == null ? null : Number(query.$top);
  const skip = query.$skip == null ? 0 : Number(query.$skip);
  if ((top != null && (!Number.isInteger(top) || top < 0 || top > FEED_MAX_TOP * 1000)) || !Number.isInteger(skip) || skip < 0) throw new FeedQueryError("$top and $skip must be whole numbers.");
  // Server-driven paging: at most FEED_PAGE_SIZE rows per response, with a next link for the rest.
  const pageSize = Math.min(top ?? FEED_PAGE_SIZE, FEED_PAGE_SIZE);
  let props = set.properties;
  if (query.$select) {
    const wanted = query.$select.split(",").map((x) => x.trim());
    const unknown = wanted.filter((w) => !set.properties.some((p) => p.name === w));
    if (unknown.length) throw new FeedQueryError(`Unknown property: ${unknown.join(", ")}.`);
    props = set.properties.filter((p) => wanted.includes(p.name));
  }
  const scope = sql`${visibleJobIds(actor)}`;
  const cols = sql.join(
    props.map((p) => sql`${p.sql} AS ${sql.raw(`"${p.name}"`)}`),
    sql`, `,
  );
  const res = await reportingDb.execute(sql`SELECT ${cols} FROM ${set.from(scope)} ORDER BY ${set.orderBy} LIMIT ${pageSize + 1} OFFSET ${skip}`);
  const rows = (res.rows as Record<string, unknown>[]).slice(0, pageSize).map((r) => {
    for (const p of props) if (p.type === "Edm.DateTimeOffset" && r[p.name] instanceof Date) r[p.name] = (r[p.name] as Date).toISOString();
    return r;
  });
  const more = res.rows.length > pageSize && (top == null || top > pageSize);
  let count: number | undefined;
  if (query.$count === "true") count = Number((await reportingDb.execute(sql`SELECT count(*)::int AS n FROM ${set.from(scope)}`)).rows[0]?.n ?? 0);
  await db.transaction((tx) =>
    recordAudit(tx, actor, "report.exported", "report_feed_token", tokenId, { kind: "odata", entitySet: name, rows: rows.length, skip, properties: props.length }),
  );
  return { rows, next: more ? { skip: skip + pageSize, top: top == null ? null : top - pageSize } : null, count, props };
}

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");

/** CSDL for the sets this actor may read. */
export function metadataDocument(actor: UserActor) {
  const sets = feedCatalogue(actor);
  const types = sets
    .map((e) => {
      const keys = (KEYS[e.name] ?? ["Id"]).map((k) => `<PropertyRef Name="${k}"/>`).join("");
      const props = e.properties.map((p) => `<Property Name="${p.name}" Type="${p.type}" Nullable="${p.nullable === false ? "false" : "true"}"/>`).join("");
      return `<EntityType Name="${xml(e.type)}"><Key>${keys}</Key>${props}</EntityType>`;
    })
    .join("");
  const container = sets.map((e) => `<EntitySet Name="${e.name}" EntityType="PATS.${e.type}"/>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<edmx:Edmx Version="4.0" xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx"><edmx:DataServices><Schema Namespace="PATS" xmlns="http://docs.oasis-open.org/odata/ns/edm">${types}<EntityContainer Name="Reporting">${container}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}

export function serviceDocument(actor: UserActor, base: string) {
  return {
    "@odata.context": `${base}/$metadata`,
    value: feedCatalogue(actor).map((e) => ({ name: e.name, kind: "EntitySet", url: e.name })),
  };
}
