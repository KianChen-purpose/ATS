import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import { queue } from "@/server/integrations/queue";
import { mockM365 } from "@/server/integrations/m365/mock";
import type { MailMessage } from "@/server/integrations/m365";
import * as sync from "@/server/services/mail-sync";
import { encryptSecret } from "@/server/security/crypto";
import { makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

process.env.TOKEN_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const SHARED = "careers@purpose.test";
let n = 0;
const msg = (o: Partial<MailMessage> = {}): MailMessage => ({
  id: `m${++n}`,
  internetMessageId: `<m${n}@mail.test>`,
  conversationId: "",
  from: "someone@example.org",
  to: [SHARED],
  subject: "Re: Your application",
  bodyText: "Thanks!",
  receivedAt: new Date(),
  ...o,
});

async function world() {
  const rec = userActor(await makeUser("recruiter", "Rita Recruiter"));
  const other = userActor(await makeUser("recruiter"));
  const job = await makeJob({ recruiterId: rec.id, title: "Analyst" });
  const secret = await makeJob({ recruiterId: rec.id, confidential: true });
  const cand = await makeCandidate({ email: "ada@example.org" });
  const [app] = await db.insert(s.applications).values({ candidateId: cand.id, jobId: job.job.id, stageId: job.stages[1].id }).returning();
  const [sent] = await db
    .insert(s.emails)
    .values({ candidateId: cand.id, applicationId: app.id, direction: "outbound", fromAddress: rec.email, toAddress: cand.email!, subject: "Next steps", body: "Hi Ada", sentById: rec.id, externalThreadId: "conv-1", externalMessageId: "out-1" })
    .returning();
  return { rec, other, job, secret, cand, app, sent };
}

describe("queue", () => {
  beforeEach(resetDb);

  it("deduplicates, runs, retries with backoff, dead-letters, and recovers stale jobs", async () => {
    const q = queue();
    expect((await q.enqueue("t.ok", { a: 1 }, { dedupeKey: "k1" })).id).toBeTruthy();
    expect((await q.enqueue("t.ok", { a: 1 }, { dedupeKey: "k1" })).id).toBeNull();
    await q.enqueue("t.fail", {}, { maxAttempts: 2 });
    await q.enqueue("t.unhandled", {});
    const seen: unknown[] = [];
    const handlers = { "t.ok": async (j: { payload: unknown }) => void seen.push(j.payload), "t.fail": async () => { throw new Error("boom for x@y.org"); } };
    expect(await q.work(handlers)).toEqual({ done: 1, retried: 1, dead: 0 });
    expect(seen).toEqual([{ a: 1 }]);
    const failed = await db.query.jobQueue.findFirst({ where: eq(s.jobQueue.type, "t.fail") });
    expect(failed!.runAt.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(failed!.lastError).not.toContain("x@y.org");
    await db.update(s.jobQueue).set({ runAt: new Date() }).where(eq(s.jobQueue.id, failed!.id));
    expect(await q.work(handlers)).toEqual({ done: 0, retried: 0, dead: 1 });
    expect((await db.query.jobQueue.findFirst({ where: eq(s.jobQueue.type, "t.unhandled") }))!.status).toBe("queued");

    const { id } = await q.enqueue("t.ok", { b: 2 });
    await db.update(s.jobQueue).set({ status: "running", lockedAt: new Date(Date.now() - 11 * 60_000) }).where(eq(s.jobQueue.id, id!));
    expect((await q.work(handlers)).done).toBe(1);
  });
});

describe("mail sync", () => {
  beforeEach(async () => {
    await resetDb();
    process.env.M365_SENDER_MAILBOX = SHARED;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.M365_SENDER_MAILBOX;
    delete process.env.APP_URL;
  });

  it("imports a reply in a PATS conversation onto the right application, once, and tells the sender", async () => {
    const w = await world();
    const r = await sync.ingestInboundMessage(w.rec.email, msg({ conversationId: "conv-1", from: "ADA@example.org", to: [w.rec.email] }));
    expect(r).toMatchObject({ status: "imported", candidateId: w.cand.id, applicationId: w.app.id });
    const inbound = await db.query.emails.findMany({ where: eq(s.emails.direction, "inbound") });
    expect(inbound).toHaveLength(1);
    expect(inbound[0]).toMatchObject({ applicationId: w.app.id, fromAddress: "ada@example.org" });
    expect((await db.query.activities.findMany({ where: eq(s.activities.candidateId, w.cand.id) })).map((a) => a.body)).toContain("Replied: Re: Your application");
    expect((await db.query.auditLogs.findMany({ where: eq(s.auditLogs.action, "email.received") }))[0].metadata).toMatchObject({ systemActor: "worker", mailbox: "user" });
    const teams = await db.query.integrationEvents.findMany({ where: eq(s.integrationEvents.service, "teams") });
    expect(teams).toHaveLength(1);
    expect(JSON.stringify(teams[0])).not.toContain("Thanks!");

    // Same message reaching another mailbox, or a retried notification: stored once.
    const again = msg({ conversationId: "conv-1", from: "ada@example.org" });
    again.internetMessageId = inbound[0].externalMessageId!;
    expect(await sync.ingestInboundMessage(SHARED, again)).toEqual({ status: "skipped", reason: "already imported" });
  });

  it("never imports a user's unrelated mail; the shared mailbox matches known candidates only", async () => {
    const w = await world();
    expect(await sync.ingestInboundMessage(w.rec.email, msg({ from: "ada@example.org" }))).toMatchObject({ status: "skipped", reason: "not a PATS conversation" });
    expect(await sync.ingestInboundMessage(SHARED, msg({ from: "stranger@example.org" }))).toMatchObject({ reason: "unknown sender" });
    expect(await sync.ingestInboundMessage(SHARED, msg({ from: w.other.email }))).toMatchObject({ reason: "internal sender" });
    expect(await sync.ingestInboundMessage(SHARED, msg({ from: SHARED }))).toMatchObject({ reason: "own message" });
    expect(await sync.ingestInboundMessage(SHARED, msg({ from: "ada@example.org" }))).toMatchObject({ status: "imported", applicationId: w.app.id });

    await makeCandidate({ email: "twin@example.org" });
    await makeCandidate({ email: "TWIN@example.org" });
    expect(await sync.ingestInboundMessage(SHARED, msg({ from: "twin@example.org" }))).toMatchObject({ reason: "ambiguous sender" });

    await db.update(s.candidates).set({ anonymizedAt: new Date() }).where(eq(s.candidates.id, w.cand.id));
    expect(await sync.ingestInboundMessage(w.rec.email, msg({ conversationId: "conv-1", from: "ada@example.org" }))).toMatchObject({ reason: "candidate anonymized" });
  });

  it("webhook: drops forged notifications, queues real ones, and the worker fetches and imports", async () => {
    const w = await world();
    const secret = "client-state-secret";
    await db.insert(s.graphSubscriptions).values({ id: "sub-1", mailbox: w.rec.email, clientStateHash: createHash("sha256").update(secret).digest("hex"), expiresAt: new Date(Date.now() + 86_400_000) });
    expect(await sync.acceptNotifications({ value: [{ subscriptionId: "sub-1", clientState: "wrong", resourceData: { id: "x" } }, { subscriptionId: "nope", clientState: secret }] })).toBe(0);
    expect(await sync.acceptNotifications({ value: [{ subscriptionId: "sub-1", clientState: secret, resourceData: { id: "AAMk1" } }] })).toBe(1);
    expect(await sync.acceptNotifications({ value: [{ subscriptionId: "sub-1", clientState: secret, resourceData: { id: "AAMk1" } }] })).toBe(1);
    const jobs = await db.query.jobQueue.findMany();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: "mail.fetch", payload: { mailbox: w.rec.email, messageId: "AAMk1" } });

    vi.spyOn(mockM365.mail, "getMessage").mockResolvedValue(msg({ id: "AAMk1", conversationId: "conv-1", from: "ada@example.org" }));
    expect((await queue().work(sync.mailSyncHandlers)).done).toBe(1);
    expect(await db.query.emails.findMany({ where: eq(s.emails.direction, "inbound") })).toHaveLength(1);
  });

  it("keeps subscriptions for the shared mailbox and consenting users, renews and removes them", async () => {
    const w = await world();
    expect((await sync.ensureSubscriptions()).skipped).toMatch(/https/);
    process.env.APP_URL = "https://pats.test";
    await db.insert(s.userOauthTokens).values({ userId: w.rec.id, refreshTokenEnc: encryptSecret("rt"), scopes: "Mail.Send" });
    expect(await sync.ensureSubscriptions()).toMatchObject({ created: 2, renewed: 0, removed: 0 });
    const subs = await db.query.graphSubscriptions.findMany();
    expect(subs.map((x) => x.mailbox).sort()).toEqual([SHARED, w.rec.email.toLowerCase()].sort());
    expect(subs.every((x) => x.clientStateHash.length === 64)).toBe(true);

    await db.update(s.graphSubscriptions).set({ expiresAt: new Date(Date.now() + 3_600_000) }).where(eq(s.graphSubscriptions.mailbox, SHARED));
    await db.delete(s.userOauthTokens).where(eq(s.userOauthTokens.userId, w.rec.id));
    expect(await sync.ensureSubscriptions()).toMatchObject({ created: 0, renewed: 1, removed: 1 });
  });

  it("delta sync imports missed replies and keeps its position", async () => {
    const w = await world();
    const spy = vi.spyOn(mockM365.mail, "delta").mockResolvedValue({ messages: [msg({ conversationId: "conv-1", from: "ada@example.org" }), msg({ from: "spam@example.org" })], deltaLink: "delta-2" });
    expect(await sync.syncMailbox(SHARED)).toEqual({ messages: 2, imported: 1 });
    expect((await db.query.mailSyncState.findFirst({ where: eq(s.mailSyncState.mailbox, SHARED) }))!.deltaLink).toBe("delta-2");
    await sync.syncMailbox(SHARED);
    expect(spy.mock.calls[1][1]).toBe("delta-2");
    void w;
  });

  it("demo replies follow job visibility", async () => {
    const w = await world();
    const [hidden] = await db
      .insert(s.emails)
      .values({ candidateId: w.cand.id, applicationId: (await db.insert(s.applications).values({ candidateId: w.cand.id, jobId: w.secret.job.id, stageId: w.secret.stages[1].id }).returning())[0].id, direction: "outbound", fromAddress: w.rec.email, toAddress: "ada@example.org", subject: "Secret", body: "x", externalThreadId: "conv-2" })
      .returning();
    await expect(sync.simulateCandidateReply(w.other, hidden.id)).rejects.toThrow(/not found/i);
    expect((await sync.simulateCandidateReply(w.rec, w.sent.id)).status).toBe("imported");
  });
});
