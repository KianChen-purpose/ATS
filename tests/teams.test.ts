import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as approvals from "@/server/services/approvals";
import * as jobs from "@/server/services/jobs";
import { trustedServiceUrl, verifyBotRequest } from "@/server/integrations/teams";
import { handleBotActivity } from "@/server/services/teams-bot";
import { teamsAppPackage, teamsManifest } from "@/server/services/teams-app";
import { makeBrand, makeUser, resetDb } from "./fixtures";

const BOT = "bbbbbbbb-1111-2222-3333-444444444444";
const SERVICE = "https://smba.trafficmanager.net/amer/";
let key: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
beforeAll(async () => {
  process.env.TEAMS_BOT_APP_ID = BOT;
  const kp = await generateKeyPair("RS256");
  key = kp.privateKey as CryptoKey;
  jwks = createLocalJWKSet({ keys: [{ ...((await exportJWK(kp.publicKey)) as JWK), kid: "b1", alg: "RS256" }] });
});
afterAll(() => {
  delete process.env.TEAMS_BOT_APP_ID;
});

const botToken = (claims: Record<string, unknown> = {}, aud = BOT, iss = "https://api.botframework.com") =>
  new SignJWT({ serviceurl: SERVICE, ...claims }).setProtectedHeader({ alg: "RS256", kid: "b1" }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime("5m").sign(key);

async function world() {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter"));
  const hm = userActor(await makeUser("hiring_manager", "Hana Manager"));
  const cpo = userActor(await makeUser("executive", "Chris CPO"));
  await db.update(s.users).set({ entraObjectId: "aad-hm" }).where(eq(s.users.id, hm.id));
  await db.update(s.users).set({ entraObjectId: "aad-cpo" }).where(eq(s.users.id, cpo.id));
  const brand = await makeBrand();
  await approvals.saveChain(
    admin,
    approvals.chainSchema.parse({ name: "Jobs", subject: "job", brandId: null, departmentId: null, minAmount: null, steps: [{ approverType: "hiring_manager", approverId: null }, { approverType: "user", approverId: cpo.id }] }),
  );
  return { admin, rec, hm, cpo, brand };
}
const install = (aad: string, conv = `conv-${aad}`) =>
  handleBotActivity({ type: "conversationUpdate", serviceUrl: SERVICE, from: { aadObjectId: aad }, conversation: { id: conv, conversationType: "personal", tenantId: "t" }, membersAdded: [{ id: "bot" }] });
const press = (aad: string, verb: string, requestId: string, comment?: string) =>
  handleBotActivity({ type: "invoke", name: "adaptiveCard/action", serviceUrl: SERVICE, from: { aadObjectId: aad }, conversation: { id: `conv-${aad}` }, value: { action: { verb, data: { requestId, ...(comment ? { comment } : {}) } } } });
const cardText = (r: { body?: unknown }) => JSON.stringify(r.body);

describe("Teams bot", () => {
  beforeEach(resetDb);

  it("verifies Bot Framework tokens: issuer, audience and serviceUrl", async () => {
    await expect(verifyBotRequest(`Bearer ${await botToken()}`, SERVICE, jwks)).resolves.toBeTruthy();
    await expect(verifyBotRequest(`Bearer ${await botToken({}, "someone-else")}`, SERVICE, jwks)).rejects.toThrow();
    await expect(verifyBotRequest(`Bearer ${await botToken({}, BOT, "https://evil.example")}`, SERVICE, jwks)).rejects.toThrow();
    await expect(verifyBotRequest(`Bearer ${await botToken()}`, "https://smba.trafficmanager.net/emea/", jwks)).rejects.toThrow();
    await expect(verifyBotRequest(null, SERVICE, jwks)).rejects.toThrow();
    expect(trustedServiceUrl(SERVICE)).toBe(true);
    expect(trustedServiceUrl("https://evil.example/")).toBe(false);
    expect(trustedServiceUrl("http://smba.trafficmanager.net/")).toBe(false);
  });

  it("install stores the conversation and delivers the cards already waiting; approve in Teams moves the chain on", async () => {
    const w = await world();
    const jobId = await jobs.createJob(w.rec, jobs.createJobSchema.parse({ title: "Analyst", brandId: w.brand.id, employmentType: "full_time", workplaceType: "hybrid", status: "open", confidential: false, hiringManagerId: w.hm.id, openings: 1 }));
    const req = (await approvals.latestApproval("job", jobId))!;

    await install("aad-hm");
    expect(await db.query.teamsConversations.findFirst({ where: eq(s.teamsConversations.userId, w.hm.id) })).toMatchObject({ conversationId: "conv-aad-hm" });
    expect(await db.query.teamsCardMessages.findMany()).toHaveLength(1);
    await install("aad-cpo");

    // Refresh shows the actionable card to the approver whose turn it is…
    const refreshed = await press("aad-hm", "approval.refresh", req.id);
    expect(cardText(refreshed)).toContain("approval.approve");
    // …and not to someone whose turn it isn't.
    expect(cardText(await press("aad-cpo", "approval.refresh", req.id))).not.toContain("approval.approve");

    const after = await press("aad-hm", "approval.approve", req.id);
    expect(after.status).toBe(200);
    expect(cardText(after)).not.toContain("approval.approve");
    const steps = await db.query.approvalSteps.findMany({ where: eq(s.approvalSteps.requestId, req.id) });
    expect(steps.find((x) => x.approverId === w.hm.id)!.status).toBe("approved");
    // The next approver got their card as soon as it became their turn.
    expect((await db.query.teamsCardMessages.findMany()).map((m) => m.userId).sort()).toEqual([w.hm.id, w.cpo.id].sort());
    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "approval.step_approved") });
    expect(audit[0].actorId).toBe(w.hm.id);

    // Rejecting needs a comment; the card says so instead of failing.
    expect(cardText(await press("aad-cpo", "approval.reject", req.id))).toContain("Add a comment");
    await press("aad-cpo", "approval.reject", req.id, "Budget freeze");
    expect((await approvals.latestApproval("job", jobId))!.status).toBe("rejected");
    // Pressing again later is harmless.
    expect(cardText(await press("aad-cpo", "approval.approve", req.id))).toMatch(/already decided|Not approved/);
  });

  it("unknown Teams users, other people's approvals and bad ids get a message card, never a decision", async () => {
    const w = await world();
    const jobId = await jobs.createJob(w.rec, jobs.createJobSchema.parse({ title: "Analyst", brandId: w.brand.id, employmentType: "full_time", workplaceType: "hybrid", status: "open", confidential: false, hiringManagerId: w.hm.id, openings: 1 }));
    const req = (await approvals.latestApproval("job", jobId))!;
    expect(cardText(await press("aad-stranger", "approval.approve", req.id))).toContain("Sign in to PATS");
    expect(cardText(await press("aad-cpo", "approval.approve", req.id))).not.toContain("approval.approve");
    expect(cardText(await press("aad-hm", "approval.approve", "not-a-uuid"))).toContain("couldn't be found");
    expect((await db.query.approvalSteps.findMany({ where: eq(s.approvalSteps.requestId, req.id) })).every((x) => x.status === "pending")).toBe(true);
    // A channel conversation or a foreign serviceUrl is never stored.
    await handleBotActivity({ type: "conversationUpdate", serviceUrl: "https://evil.example/", from: { aadObjectId: "aad-hm" }, conversation: { id: "c", conversationType: "personal" } });
    await handleBotActivity({ type: "conversationUpdate", serviceUrl: SERVICE, from: { aadObjectId: "aad-hm" }, conversation: { id: "c", conversationType: "channel" } });
    expect(await db.query.teamsConversations.findMany()).toHaveLength(0);
  });

  it("builds an uploadable app package (admins only)", async () => {
    const admin = userActor(await makeUser("admin"));
    const zip = new PizZip(teamsAppPackage(admin));
    const manifest = JSON.parse(zip.file("manifest.json")!.asText());
    expect(manifest).toMatchObject({ manifestVersion: "1.17", bots: [{ botId: BOT, scopes: ["personal"] }] });
    expect(manifest.activities.activityTypes[0].type).toBe("patsNotification");
    expect(zip.file("color.png")!.asNodeBuffer().subarray(1, 4).toString()).toBe("PNG");
    expect(teamsManifest().id).toBe(teamsManifest().id);
    expect(() => teamsAppPackage(userActor({ id: admin.id, role: "recruiter", name: "", email: "", timezone: "UTC" }))).toThrow();
  });
});
