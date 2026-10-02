import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { canViewSettings, ForbiddenError, systemActor, type Role, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";
import type { Tx } from "./tx";

/**
 * SCIM 2.0 provisioning for Microsoft Entra ID (RFC 7643/7644, ARCHITECTURE.md §6.1). Entra creates,
 * updates and deactivates PATS accounts and pushes group memberships; groups an admin maps to a
 * role set the member's PATS role. Deprovisioning deactivates (history stays) and revokes the
 * user's delegated Microsoft tokens. Every change is audited as the "scim" system actor.
 */

export const SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCIM_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCIM_LIST = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCIM_ERROR = "urn:ietf:params:scim:api:messages:2.0:Error";
export const SCIM_PATCH = "urn:ietf:params:scim:api:messages:2.0:PatchOp";
const ENTERPRISE = "urn:ietf:params:scim:schemas:extension:enterprise:2.0:User";

const actor = systemActor("scim");
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Highest wins when someone is in several mapped groups (same order as Entra app roles). */
const ROLE_PRECEDENCE: Role[] = ["admin", "recruiter", "coordinator", "executive", "hiring_manager", "interviewer"];
export const ROLES = s.userRole.enumValues;

export class ScimError extends Error {
  constructor(
    public status: 400 | 401 | 404 | 409 | 501,
    message: string,
    public scimType?: string,
  ) {
    super(message);
    this.name = "ScimError";
  }
}

// ---------------------------------------------------------------------------
// Tokens (admin)
// ---------------------------------------------------------------------------

function requireAdmin(a: UserActor) {
  if (!canViewSettings(a)) throw new ForbiddenError();
}

export async function createScimToken(admin: UserActor, name: string) {
  requireAdmin(admin);
  const n = z.string().trim().min(2).max(80).parse(name);
  const token = `scim_${randomBytes(32).toString("base64url")}`;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(s.scimTokens).values({ name: n, tokenHash: sha256(token), prefix: token.slice(0, 10), createdById: admin.id }).returning({ id: s.scimTokens.id });
    await recordAudit(tx, admin, "scim_token.created", "scim_token", row.id, { name: n });
    return { id: row.id, token };
  });
}

export async function revokeScimToken(admin: UserActor, id: string) {
  requireAdmin(admin);
  await db.transaction(async (tx) => {
    await tx.update(s.scimTokens).set({ revokedAt: new Date() }).where(and(eq(s.scimTokens.id, id), isNull(s.scimTokens.revokedAt)));
    await recordAudit(tx, admin, "scim_token.revoked", "scim_token", id);
  });
}

export async function listScimTokens(admin: UserActor) {
  requireAdmin(admin);
  return db
    .select({ id: s.scimTokens.id, name: s.scimTokens.name, prefix: s.scimTokens.prefix, createdAt: s.scimTokens.createdAt, lastUsedAt: s.scimTokens.lastUsedAt, revokedAt: s.scimTokens.revokedAt })
    .from(s.scimTokens)
    .orderBy(asc(s.scimTokens.createdAt));
}

export async function authenticateScim(header: string | null) {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token || !/^scim_[A-Za-z0-9_-]{43}$/.test(token)) throw new ScimError(401, "A valid bearer token is required.");
  const row = await db.query.scimTokens.findFirst({ where: and(eq(s.scimTokens.tokenHash, sha256(token)), isNull(s.scimTokens.revokedAt)) });
  if (!row) throw new ScimError(401, "A valid bearer token is required.");
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) await db.update(s.scimTokens).set({ lastUsedAt: new Date() }).where(eq(s.scimTokens.id, row.id));
  return row.id;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

type UserRow = typeof s.users.$inferSelect;

export function userResource(u: UserRow, base: string) {
  const [givenName, ...rest] = u.name.split(" ");
  return {
    schemas: [SCIM_USER, ENTERPRISE],
    id: u.id,
    externalId: u.scimExternalId ?? undefined,
    userName: u.email,
    active: u.active,
    displayName: u.name,
    name: { givenName, familyName: rest.join(" ") || undefined, formatted: u.name },
    emails: [{ value: u.email, type: "work", primary: true }],
    title: u.title ?? undefined,
    meta: { resourceType: "User", created: u.createdAt.toISOString(), location: `${base}/Users/${u.id}` },
  };
}

const bool = z.union([z.boolean(), z.string().transform((v) => v.toLowerCase() === "true")]);
const userInput = z.object({
  userName: z.string().trim().min(3).max(320),
  externalId: z.string().max(200).optional(),
  active: bool.optional(),
  displayName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  name: z.object({ givenName: z.string().max(100).optional(), familyName: z.string().max(100).optional(), formatted: z.string().max(200).optional() }).partial().optional(),
  emails: z.array(z.object({ value: z.string().max(320), primary: bool.optional(), type: z.string().optional() })).optional(),
});

const emailOf = (d: z.infer<typeof userInput>) => (d.emails?.find((e) => e.primary)?.value ?? d.emails?.[0]?.value ?? d.userName).toLowerCase();
const nameOf = (d: z.infer<typeof userInput>) =>
  d.displayName || d.name?.formatted || [d.name?.givenName, d.name?.familyName].filter(Boolean).join(" ") || d.userName.split("@")[0];

async function deactivate(tx: Tx, u: UserRow) {
  await tx.update(s.users).set({ active: false }).where(eq(s.users.id, u.id));
  // Deprovisioned users keep no Microsoft access through PATS.
  await tx.delete(s.userOauthTokens).where(eq(s.userOauthTokens.userId, u.id));
  await recordAudit(tx, actor, "user.deactivated", "user", u.id, { source: "scim" });
}

export async function createUser(body: unknown) {
  const parsed = userInput.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "userName is required.", "invalidValue");
  const d = parsed.data;
  const email = emailOf(d);
  return db.transaction(async (tx) => {
    const existing = await tx.query.users.findFirst({ where: sql`lower(${s.users.email}) = ${email}` });
    if (existing?.scimExternalId) {
      throw new ScimError(409, "A user with this userName already exists.", "uniqueness");
    }
    let u: UserRow;
    if (existing) {
      // Adopt an account that predates provisioning (e.g. created by an admin).
      [u] = await tx
        .update(s.users)
        .set({ scimExternalId: d.externalId ?? null, name: nameOf(d), title: d.title ?? existing.title, active: d.active ?? true, ...(d.externalId && GUID.test(d.externalId) && !existing.entraObjectId ? { entraObjectId: d.externalId } : {}) })
        .where(eq(s.users.id, existing.id))
        .returning();
      await recordAudit(tx, actor, "user.provisioned", "user", u.id, { source: "scim", adopted: true });
    } else {
      [u] = await tx
        .insert(s.users)
        .values({ email, name: nameOf(d), title: d.title, active: d.active ?? true, role: "interviewer", scimExternalId: d.externalId, entraObjectId: d.externalId && GUID.test(d.externalId) ? d.externalId : null })
        .returning();
      await recordAudit(tx, actor, "user.created", "user", u.id, { source: "scim", role: u.role });
    }
    return u;
  });
}

export async function getUser(id: string) {
  const u = GUID.test(id) ? await db.query.users.findFirst({ where: eq(s.users.id, id) }) : undefined;
  if (!u) throw new ScimError(404, "User not found.");
  return u;
}

/** Supports the filters Entra sends: userName eq, externalId eq, id eq. */
export async function listUsers(filter: string | null, startIndex = 1, count = 100) {
  let where;
  if (filter) {
    const m = /^\s*(userName|externalId|id|emails\.value)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
    if (!m) throw new ScimError(400, "Only 'attribute eq \"value\"' filters are supported.", "invalidFilter");
    const [, attr, value] = m;
    where =
      attr.toLowerCase() === "externalid"
        ? eq(s.users.scimExternalId, value)
        : attr.toLowerCase() === "id"
          ? GUID.test(value)
            ? eq(s.users.id, value)
            : sql`false`
          : sql`lower(${s.users.email}) = ${value.toLowerCase()}`;
  }
  const take = Math.min(Math.max(count, 0), 200);
  const [rows, [{ n }]] = await Promise.all([
    db.query.users.findMany({ where, orderBy: asc(s.users.createdAt), limit: take, offset: Math.max(startIndex, 1) - 1 }),
    db.select({ n: sql<number>`count(*)::int` }).from(s.users).where(where),
  ]);
  return { rows, total: n };
}

async function applyUserChanges(tx: Tx, u: UserRow, changes: Partial<{ email: string; name: string; title: string | null; active: boolean; externalId: string }>) {
  const set: Partial<typeof s.users.$inferInsert> = {};
  if (changes.email && changes.email !== u.email) set.email = changes.email;
  if (changes.name && changes.name !== u.name) set.name = changes.name;
  if (changes.title !== undefined && changes.title !== u.title) set.title = changes.title;
  if (changes.externalId !== undefined && changes.externalId !== u.scimExternalId) set.scimExternalId = changes.externalId;
  if (Object.keys(set).length) {
    await tx.update(s.users).set(set).where(eq(s.users.id, u.id));
    await recordAudit(tx, actor, "user.updated", "user", u.id, { source: "scim", fields: Object.keys(set) });
  }
  if (changes.active === false && u.active) await deactivate(tx, u);
  if (changes.active === true && !u.active) {
    await tx.update(s.users).set({ active: true }).where(eq(s.users.id, u.id));
    await recordAudit(tx, actor, "user.reactivated", "user", u.id, { source: "scim" });
  }
}

export async function replaceUser(id: string, body: unknown) {
  const u = await getUser(id);
  const parsed = userInput.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "userName is required.", "invalidValue");
  const d = parsed.data;
  await db.transaction((tx) => applyUserChanges(tx, u, { email: emailOf(d), name: nameOf(d), title: d.title ?? null, active: d.active ?? true, externalId: d.externalId }));
  return getUser(id);
}

const patchSchema = z.object({
  Operations: z.array(z.object({ op: z.string(), path: z.string().optional(), value: z.unknown().optional() })).max(100),
});

const asBool = (v: unknown) => (typeof v === "string" ? v.toLowerCase() === "true" : Boolean(v));

/** PATCH as Entra sends it: Replace/Add with a path, or with a value object and no path. */
export async function patchUser(id: string, body: unknown) {
  const u = await getUser(id);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "Invalid PATCH request.", "invalidSyntax");
  const changes: Parameters<typeof applyUserChanges>[2] = {};
  let given: string | undefined;
  let family: string | undefined;
  const setAttr = (path: string, value: unknown) => {
    const p = path.toLowerCase();
    if (p === "active") changes.active = asBool(value);
    else if (p === "displayname" || p === "name.formatted") changes.name = String(value);
    else if (p === "name.givenname") given = String(value);
    else if (p === "name.familyname") family = String(value);
    else if (p === "title") changes.title = value == null ? null : String(value);
    else if (p === "externalid") changes.externalId = String(value);
    else if (p === "username" || p.startsWith("emails")) changes.email = String(value).toLowerCase();
    // Attributes PATS doesn't keep (phone, department, manager…) are accepted and ignored.
  };
  for (const op of parsed.data.Operations) {
    const kind = op.op.toLowerCase();
    if (kind === "remove") {
      if (op.path?.toLowerCase() === "title") changes.title = null;
      continue;
    }
    if (kind !== "replace" && kind !== "add") throw new ScimError(400, `Unsupported op "${op.op}".`, "invalidSyntax");
    if (op.path) setAttr(op.path, op.value);
    else if (op.value && typeof op.value === "object") {
      for (const [k, v] of Object.entries(op.value as Record<string, unknown>)) {
        if (k === "name" && v && typeof v === "object") for (const [nk, nv] of Object.entries(v)) setAttr(`name.${nk}`, nv);
        else setAttr(k, v);
      }
    }
  }
  if ((given || family) && !changes.name) {
    const [g0, ...f0] = u.name.split(" ");
    changes.name = [given ?? g0, family ?? f0.join(" ")].filter(Boolean).join(" ");
  }
  await db.transaction((tx) => applyUserChanges(tx, u, changes));
  return getUser(id);
}

/** DELETE never deletes a person (their history stays): it deactivates them. */
export async function deleteUser(id: string) {
  const u = await getUser(id);
  await db.transaction(async (tx) => {
    if (u.active) await deactivate(tx, u);
  });
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

type GroupRow = typeof s.scimGroups.$inferSelect;

export async function groupResource(g: GroupRow, base: string, withMembers = true) {
  const members = withMembers
    ? await db.select({ id: s.users.id, name: s.users.name }).from(s.scimGroupMembers).innerJoin(s.users, eq(s.users.id, s.scimGroupMembers.userId)).where(eq(s.scimGroupMembers.groupId, g.id))
    : [];
  return {
    schemas: [SCIM_GROUP],
    id: g.id,
    externalId: g.externalId ?? undefined,
    displayName: g.displayName,
    members: withMembers ? members.map((m) => ({ value: m.id, display: m.name, $ref: `${base}/Users/${m.id}` })) : undefined,
    meta: { resourceType: "Group", created: g.createdAt.toISOString(), lastModified: g.updatedAt.toISOString(), location: `${base}/Groups/${g.id}` },
  };
}

/**
 * Recomputes the PATS role of users from their mapped groups. People in no mapped group keep their
 * role (it may come from Entra app roles at sign-in instead).
 */
async function syncRoles(tx: Tx, userIds: string[]) {
  const ids = [...new Set(userIds)];
  if (!ids.length) return;
  const memberships = await tx
    .select({ userId: s.scimGroupMembers.userId, role: s.scimGroups.role })
    .from(s.scimGroupMembers)
    .innerJoin(s.scimGroups, eq(s.scimGroups.id, s.scimGroupMembers.groupId))
    .where(inArray(s.scimGroupMembers.userId, ids));
  const users = await tx.query.users.findMany({ where: inArray(s.users.id, ids) });
  for (const u of users) {
    const roles = new Set(memberships.filter((m) => m.userId === u.id && m.role).map((m) => m.role!));
    const role = ROLE_PRECEDENCE.find((r) => roles.has(r));
    if (role && role !== u.role) {
      await tx.update(s.users).set({ role }).where(eq(s.users.id, u.id));
      await recordAudit(tx, actor, "user.role_changed", "user", u.id, { from: u.role, to: role, source: "scim_group" });
    }
  }
}

const groupInput = z.object({
  displayName: z.string().trim().min(1).max(256),
  externalId: z.string().max(200).optional(),
  members: z.array(z.object({ value: z.string() })).max(5000).optional(),
});

async function validMemberIds(tx: Tx, values: string[]) {
  const ids = values.filter((v) => GUID.test(v));
  if (!ids.length) return [];
  const rows = await tx.select({ id: s.users.id }).from(s.users).where(inArray(s.users.id, ids));
  return rows.map((r) => r.id);
}

export async function createGroup(body: unknown) {
  const parsed = groupInput.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "displayName is required.", "invalidValue");
  const d = parsed.data;
  return db.transaction(async (tx) => {
    if (d.externalId && (await tx.query.scimGroups.findFirst({ where: eq(s.scimGroups.externalId, d.externalId) }))) throw new ScimError(409, "Group already exists.", "uniqueness");
    const [g] = await tx.insert(s.scimGroups).values({ displayName: d.displayName, externalId: d.externalId }).returning();
    const members = await validMemberIds(tx, (d.members ?? []).map((m) => m.value));
    if (members.length) await tx.insert(s.scimGroupMembers).values(members.map((userId) => ({ groupId: g.id, userId }))).onConflictDoNothing();
    await recordAudit(tx, actor, "scim_group.created", "scim_group", g.id, { displayName: d.displayName, members: members.length });
    return g;
  });
}

export async function getGroup(id: string) {
  const g = GUID.test(id) ? await db.query.scimGroups.findFirst({ where: eq(s.scimGroups.id, id) }) : undefined;
  if (!g) throw new ScimError(404, "Group not found.");
  return g;
}

export async function listGroups(filter: string | null, startIndex = 1, count = 100) {
  let where;
  if (filter) {
    const m = /^\s*(displayName|externalId|id)\s+eq\s+"([^"]*)"\s*$/i.exec(filter);
    if (!m) throw new ScimError(400, "Only 'attribute eq \"value\"' filters are supported.", "invalidFilter");
    const [, attr, value] = m;
    where = attr.toLowerCase() === "displayname" ? eq(s.scimGroups.displayName, value) : attr.toLowerCase() === "externalid" ? eq(s.scimGroups.externalId, value) : GUID.test(value) ? eq(s.scimGroups.id, value) : sql`false`;
  }
  const take = Math.min(Math.max(count, 0), 200);
  const [rows, [{ n }]] = await Promise.all([
    db.query.scimGroups.findMany({ where, orderBy: asc(s.scimGroups.createdAt), limit: take, offset: Math.max(startIndex, 1) - 1 }),
    db.select({ n: sql<number>`count(*)::int` }).from(s.scimGroups).where(where),
  ]);
  return { rows, total: n };
}

export async function patchGroup(id: string, body: unknown) {
  const g = await getGroup(id);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) throw new ScimError(400, "Invalid PATCH request.", "invalidSyntax");
  await db.transaction(async (tx) => {
    const touched: string[] = [];
    for (const op of parsed.data.Operations) {
      const kind = op.op.toLowerCase();
      const path = op.path ?? "";
      const memberValues = (v: unknown) => (Array.isArray(v) ? v.map((m) => String((m as { value?: unknown }).value ?? "")) : []);
      if (path.toLowerCase() === "members" && (kind === "add" || kind === "replace")) {
        const ids = await validMemberIds(tx, memberValues(op.value));
        if (kind === "replace") {
          const prev = await tx.select({ userId: s.scimGroupMembers.userId }).from(s.scimGroupMembers).where(eq(s.scimGroupMembers.groupId, g.id));
          touched.push(...prev.map((p) => p.userId));
          await tx.delete(s.scimGroupMembers).where(eq(s.scimGroupMembers.groupId, g.id));
        }
        if (ids.length) await tx.insert(s.scimGroupMembers).values(ids.map((userId) => ({ groupId: g.id, userId }))).onConflictDoNothing();
        touched.push(...ids);
      } else if (kind === "remove" && path.toLowerCase().startsWith("members")) {
        // members[value eq "id"] or members with a value list.
        const m = /members\[value eq "([^"]+)"\]/i.exec(path);
        const ids = m ? [m[1]] : memberValues(op.value);
        const valid = ids.filter((x) => GUID.test(x));
        if (valid.length) await tx.delete(s.scimGroupMembers).where(and(eq(s.scimGroupMembers.groupId, g.id), inArray(s.scimGroupMembers.userId, valid)));
        touched.push(...valid);
      } else if ((kind === "replace" || kind === "add") && (path.toLowerCase() === "displayname" || (!path && op.value && typeof op.value === "object"))) {
        const v = path ? op.value : (op.value as Record<string, unknown>).displayName;
        if (typeof v === "string" && v.trim()) await tx.update(s.scimGroups).set({ displayName: v.trim(), updatedAt: new Date() }).where(eq(s.scimGroups.id, g.id));
      } else if (kind === "replace" && path.toLowerCase() === "externalid") {
        await tx.update(s.scimGroups).set({ externalId: String(op.value), updatedAt: new Date() }).where(eq(s.scimGroups.id, g.id));
      } else {
        throw new ScimError(400, `Unsupported group operation "${op.op} ${path}".`, "invalidSyntax");
      }
    }
    await tx.update(s.scimGroups).set({ updatedAt: new Date() }).where(eq(s.scimGroups.id, g.id));
    await recordAudit(tx, actor, "scim_group.updated", "scim_group", g.id, { members_changed: touched.length });
    await syncRoles(tx, touched);
  });
  return getGroup(id);
}

export async function deleteGroup(id: string) {
  const g = await getGroup(id);
  await db.transaction(async (tx) => {
    await tx.delete(s.scimGroupMembers).where(eq(s.scimGroupMembers.groupId, g.id));
    await tx.delete(s.scimGroups).where(eq(s.scimGroups.id, g.id));
    await recordAudit(tx, actor, "scim_group.deleted", "scim_group", g.id, { displayName: g.displayName });
  });
}

// ---------------------------------------------------------------------------
// Admin: group → role mapping
// ---------------------------------------------------------------------------

export async function listGroupMappings(admin: UserActor) {
  requireAdmin(admin);
  return db
    .select({ id: s.scimGroups.id, displayName: s.scimGroups.displayName, role: s.scimGroups.role, members: sql<number>`(SELECT count(*)::int FROM scim_group_members m WHERE m.group_id = ${s.scimGroups.id})` })
    .from(s.scimGroups)
    .orderBy(asc(s.scimGroups.displayName));
}

export async function setGroupRole(admin: UserActor, groupId: string, role: Role | null) {
  requireAdmin(admin);
  const g = await getGroup(groupId);
  await db.transaction(async (tx) => {
    await tx.update(s.scimGroups).set({ role, updatedAt: new Date() }).where(eq(s.scimGroups.id, g.id));
    await recordAudit(tx, admin, "scim_group.role_mapped", "scim_group", g.id, { from: g.role, to: role });
    const members = await tx.select({ userId: s.scimGroupMembers.userId }).from(s.scimGroupMembers).where(eq(s.scimGroupMembers.groupId, g.id));
    await syncRoles(tx, members.map((m) => m.userId));
  });
}
