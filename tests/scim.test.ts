import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as scim from "@/server/services/scim";
import { encryptSecret } from "@/server/security/crypto";
import { GET, PATCH, POST, DELETE } from "@/app/api/scim/v2/[...path]/route";
import { makeUser, resetDb } from "./fixtures";

process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const entraUser = (o: Record<string, unknown> = {}) => ({
  schemas: [scim.SCIM_USER],
  userName: "Priya.Patel@purpose.test",
  externalId: "0f8fad5b-d9cb-469f-a165-70867728950e",
  active: true,
  displayName: "Priya Patel",
  title: "Recruiter",
  name: { givenName: "Priya", familyName: "Patel" },
  emails: [{ primary: true, type: "work", value: "Priya.Patel@purpose.test" }],
  ...o,
});

async function call(method: string, path: string, token: string | null, body?: unknown) {
  const req = new NextRequest(`http://localhost/api/scim/v2/${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/scim+json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const handler = { GET, POST, PATCH, DELETE }[method as "GET"]!;
  const res = await handler(req, { params: Promise.resolve({ path: path.split("?")[0].split("/") }) } as never);
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
}

describe("SCIM provisioning", () => {
  let token: string;
  beforeEach(async () => {
    await resetDb();
    const admin = userActor(await makeUser("admin"));
    token = (await scim.createScimToken(admin, "Entra provisioning")).token;
  });

  it("requires a valid bearer token; revoked tokens stop working", async () => {
    expect((await call("GET", "Users", null)).status).toBe(401);
    expect((await call("GET", "Users", "scim_" + "x".repeat(43))).status).toBe(401);
    expect((await call("GET", "ServiceProviderConfig", token)).body.patch.supported).toBe(true);
    const admin = userActor((await db.query.users.findFirst({ where: eq(s.users.role, "admin") }))!);
    const [t] = await scim.listScimTokens(admin);
    await scim.revokeScimToken(admin, t.id);
    expect((await call("GET", "Users", token)).status).toBe(401);
    await expect(scim.createScimToken(userActor(await makeUser("recruiter")), "nope")).rejects.toThrow();
  });

  it("creates, finds and updates users the way Entra does; duplicates conflict", async () => {
    const created = await call("POST", "Users", token, entraUser());
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ userName: "priya.patel@purpose.test", active: true, displayName: "Priya Patel" });
    const u = await db.query.users.findFirst({ where: eq(s.users.id, created.body.id) });
    expect(u).toMatchObject({ role: "interviewer", entraObjectId: "0f8fad5b-d9cb-469f-a165-70867728950e" });
    expect((await call("POST", "Users", token, entraUser())).status).toBe(409);

    const found = await call("GET", `Users?filter=${encodeURIComponent('userName eq "PRIYA.PATEL@purpose.test"')}`, token);
    expect(found.body.totalResults).toBe(1);
    const none = await call("GET", `Users?filter=${encodeURIComponent('userName eq "nobody@purpose.test"')}`, token);
    expect(none.body).toMatchObject({ totalResults: 0, Resources: [] });

    const patched = await call("PATCH", `Users/${u!.id}`, token, {
      schemas: [scim.SCIM_PATCH],
      Operations: [
        { op: "Replace", path: "title", value: "Senior Recruiter" },
        { op: "Replace", path: "name.familyName", value: "Patel-Shah" },
        { op: "Add", path: "phoneNumbers[type eq \"work\"].value", value: "555" },
      ],
    });
    expect(patched.body).toMatchObject({ title: "Senior Recruiter", displayName: "Priya Patel-Shah" });
    expect((await call("GET", `Users/00000000-0000-0000-0000-000000000000`, token)).status).toBe(404);
    expect((await call("GET", "Users?filter=" + encodeURIComponent("title co \"x\""), token)).status).toBe(400);
  });

  it("adopts an existing account with the same email instead of duplicating it", async () => {
    const existing = await makeUser("recruiter");
    const res = await call("POST", "Users", token, entraUser({ userName: existing.email, emails: [{ primary: true, value: existing.email }] }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(existing.id);
    const after = await db.query.users.findFirst({ where: eq(s.users.id, existing.id) });
    expect(after!.role).toBe("recruiter");
  });

  it("deprovisioning deactivates, revokes Microsoft tokens and keeps history; reactivation works", async () => {
    const { body } = await call("POST", "Users", token, entraUser());
    await db.insert(s.userOauthTokens).values({ userId: body.id, refreshTokenEnc: encryptSecret("rt"), scopes: "Mail.Send" });
    await call("PATCH", `Users/${body.id}`, token, { Operations: [{ op: "Replace", path: "active", value: "False" }] });
    let u = await db.query.users.findFirst({ where: eq(s.users.id, body.id) });
    expect(u!.active).toBe(false);
    expect(await db.query.userOauthTokens.findFirst({ where: eq(s.userOauthTokens.userId, body.id) })).toBeUndefined();
    await call("PATCH", `Users/${body.id}`, token, { Operations: [{ op: "Replace", value: { active: true } }] });
    u = await db.query.users.findFirst({ where: eq(s.users.id, body.id) });
    expect(u!.active).toBe(true);
    expect((await call("DELETE", `Users/${body.id}`, token)).status).toBe(204);
    u = await db.query.users.findFirst({ where: eq(s.users.id, body.id) });
    expect(u).toMatchObject({ active: false });
    const actions = (await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, body.id) })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.created", "user.deactivated", "user.reactivated"]));
    expect((await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "user.deactivated") }))[0].metadata).toMatchObject({ systemActor: "scim" });
  });

  it("groups: membership add/remove and mapped roles, highest wins", async () => {
    const a = (await call("POST", "Users", token, entraUser())).body.id;
    const b = (await call("POST", "Users", token, entraUser({ userName: "sam@purpose.test", externalId: "1f8fad5b-d9cb-469f-a165-70867728950e", emails: [{ primary: true, value: "sam@purpose.test" }], displayName: "Sam" }))).body.id;
    const recruiters = (await call("POST", "Groups", token, { schemas: [scim.SCIM_GROUP], displayName: "PATS Recruiters", externalId: "g-rec", members: [{ value: a }] })).body;
    const admins = (await call("POST", "Groups", token, { schemas: [scim.SCIM_GROUP], displayName: "PATS Admins", externalId: "g-adm" })).body;
    expect(recruiters.members).toHaveLength(1);

    const admin = userActor((await db.query.users.findFirst({ where: eq(s.users.role, "admin") }))!);
    await scim.setGroupRole(admin, recruiters.id, "recruiter");
    await scim.setGroupRole(admin, admins.id, "admin");
    expect((await db.query.users.findFirst({ where: eq(s.users.id, a) }))!.role).toBe("recruiter");

    expect((await call("PATCH", `Groups/${admins.id}`, token, { Operations: [{ op: "Add", path: "members", value: [{ value: a }, { value: b }] }] })).status).toBe(204);
    expect((await db.query.users.findFirst({ where: eq(s.users.id, a) }))!.role).toBe("admin");
    expect((await db.query.users.findFirst({ where: eq(s.users.id, b) }))!.role).toBe("admin");

    await call("PATCH", `Groups/${admins.id}`, token, { Operations: [{ op: "Remove", path: `members[value eq "${a}"]` }] });
    expect((await db.query.users.findFirst({ where: eq(s.users.id, a) }))!.role).toBe("recruiter");
    const listed = await call("GET", `Groups?filter=${encodeURIComponent('displayName eq "PATS Admins"')}&excludedAttributes=members`, token);
    expect(listed.body.Resources[0]).toMatchObject({ displayName: "PATS Admins" });
    expect(listed.body.Resources[0].members).toBeUndefined();
    await call("PATCH", `Groups/${admins.id}`, token, { Operations: [{ op: "Replace", value: { displayName: "PATS Administrators" } }] });
    expect((await scim.getGroup(admins.id)).displayName).toBe("PATS Administrators");
    expect((await call("DELETE", `Groups/${admins.id}`, token)).status).toBe(204);
    expect((await call("GET", `Groups/${admins.id}`, token)).status).toBe(404);
  });
});
