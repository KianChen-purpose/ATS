import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { m365, m365Configured, type MailMessage } from "@/server/integrations/m365";
import { queue, type ClaimedJob, type JobHandler } from "@/server/integrations/queue";
import { assertCanSeeJobs, canManageRecruiting, ForbiddenError, NotFoundError, systemActor, type Actor, type UserActor } from "@/server/policy";
import { recordAudit } from "./audit";

/**
 * Two-way email (PRD §6): candidate replies land on the candidate's Emails tab and timeline.
 *
 * Sources: the shared mailbox (M365_SENDER_MAILBOX, app permission) and each signed-in user's own
 * mailbox (their delegated consent). What gets imported is deliberately narrow:
 * - any mailbox: replies in a conversation PATS started (matched by Graph conversationId);
 * - the shared mailbox only: mail from an address that belongs to exactly one candidate.
 * A user's other mail is never read into PATS.
 *
 * Graph change notifications enqueue a fetch (ids only); a delta query every 15 minutes catches
 * anything a notification missed. All Graph work runs in the worker (ARCHITECTURE.md §8.4).
 */

const worker = systemActor("worker");
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const MAX_BODY = 100_000;
/** Mail subscriptions last at most ~70 hours; renew when less than a day is left. */
const SUBSCRIPTION_MINUTES = 4000;
const RENEW_WITHIN_MS = 24 * 3_600_000;
const sharedMailbox = () => (process.env.M365_SENDER_MAILBOX ?? "").toLowerCase();
const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");

export type IngestResult = { status: "imported"; emailId: string; candidateId: string; applicationId: string | null } | { status: "skipped"; reason: string };

/** Decides whether a message belongs in PATS and stores it once. */
export async function ingestInboundMessage(mailbox: string, msg: MailMessage, actor: Actor = worker): Promise<IngestResult> {
  const box = mailbox.toLowerCase();
  const from = msg.from.toLowerCase();
  if (!from || from === box) return { status: "skipped", reason: "own message" };
  // Staff writing to each other isn't candidate correspondence.
  if (await db.query.users.findFirst({ where: sql`lower(${s.users.email}) = ${from}` })) return { status: "skipped", reason: "internal sender" };
  if (await db.query.emails.findFirst({ where: and(eq(s.emails.direction, "inbound"), eq(s.emails.externalMessageId, msg.internetMessageId)) })) {
    return { status: "skipped", reason: "already imported" };
  }

  let candidateId: string | null = null;
  let applicationId: string | null = null;
  let notifyUserId: string | null = null;
  if (msg.conversationId) {
    const thread = await db.query.emails.findFirst({
      where: and(eq(s.emails.externalThreadId, msg.conversationId), eq(s.emails.direction, "outbound")),
      orderBy: desc(s.emails.sentAt),
    });
    if (thread) {
      candidateId = thread.candidateId;
      applicationId = thread.applicationId;
      notifyUserId = thread.sentById;
    }
  }
  if (!candidateId) {
    if (box !== sharedMailbox()) return { status: "skipped", reason: "not a PATS conversation" };
    const matches = await db
      .select({ id: s.candidates.id })
      .from(s.candidates)
      .where(and(sql`lower(${s.candidates.email}) = ${from}`, isNull(s.candidates.anonymizedAt)))
      .limit(2);
    if (matches.length !== 1) return { status: "skipped", reason: matches.length ? "ambiguous sender" : "unknown sender" };
    candidateId = matches[0].id;
    const apps = await db.select({ id: s.applications.id }).from(s.applications).where(and(eq(s.applications.candidateId, candidateId), eq(s.applications.status, "active"))).limit(2);
    applicationId = apps.length === 1 ? apps[0].id : null;
  }
  const cand = await db.query.candidates.findFirst({ where: eq(s.candidates.id, candidateId) });
  if (!cand || cand.anonymizedAt) return { status: "skipped", reason: "candidate anonymized" };

  try {
    const emailId = await db.transaction(async (tx) => {
      const [email] = await tx
        .insert(s.emails)
        .values({
          candidateId: candidateId!,
          applicationId,
          direction: "inbound",
          fromAddress: from,
          toAddress: msg.to[0] ?? box,
          subject: msg.subject.slice(0, 500) || "(no subject)",
          body: msg.bodyText.slice(0, MAX_BODY),
          externalThreadId: msg.conversationId || null,
          externalMessageId: msg.internetMessageId,
          sentAt: msg.receivedAt,
        })
        .returning({ id: s.emails.id });
      await tx.insert(s.activities).values({ candidateId: candidateId!, applicationId, type: "email", body: `Replied: ${msg.subject.slice(0, 200)}`, createdAt: msg.receivedAt });
      await recordAudit(tx, actor, "email.received", "email", email.id, { candidateId, applicationId, mailbox: box === sharedMailbox() ? "shared" : "user" });
      return email.id;
    });
    // Let whoever wrote to the candidate know they replied (no message text in the notification).
    const notify = notifyUserId ? await db.query.users.findFirst({ where: eq(s.users.id, notifyUserId) }) : null;
    if (notify?.active) {
      await m365().teams.notify({ toEmail: notify.email, title: `${cand.firstName} ${cand.lastName} replied`, text: "A candidate replied to your email.", url: `/candidates/${cand.id}${applicationId ? `?app=${applicationId}` : ""}` });
    }
    return { status: "imported", emailId, candidateId, applicationId };
  } catch (e) {
    // Two mailboxes received the same reply at once: the unique index keeps one.
    if (String((e as { cause?: Error }).cause?.message ?? e).includes("emails_inbound_message_uq")) return { status: "skipped", reason: "already imported" };
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Webhook (Graph change notifications)
// ---------------------------------------------------------------------------

type Notification = { subscriptionId?: string; clientState?: string; resourceData?: { id?: string }; lifecycleEvent?: string };

function sameSecret(given: string | undefined, hash: string) {
  if (!given) return false;
  const a = Buffer.from(sha256(given));
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Accepts a notification batch: verifies each against its subscription's clientState and enqueues
 * a fetch. Unknown or forged notifications are dropped. Returns how many were accepted.
 */
export async function acceptNotifications(body: unknown) {
  const items = ((body as { value?: Notification[] })?.value ?? []).slice(0, 1000);
  let accepted = 0;
  for (const n of items) {
    if (!n.subscriptionId) continue;
    const sub = await db.query.graphSubscriptions.findFirst({ where: eq(s.graphSubscriptions.id, n.subscriptionId) });
    if (!sub || !sameSecret(n.clientState, sub.clientStateHash)) continue;
    if (n.lifecycleEvent) {
      // reauthorizationRequired / subscriptionRemoved / missed: re-establish and catch up.
      await queue().enqueue("graph.subscriptions.ensure", {}, { dedupeKey: `subs-lifecycle:${sub.id}:${Math.floor(Date.now() / 300_000)}` });
      await queue().enqueue("mail.delta", { mailbox: sub.mailbox }, { dedupeKey: `delta-lifecycle:${sub.mailbox}:${Math.floor(Date.now() / 300_000)}` });
    } else if (n.resourceData?.id) {
      await queue().enqueue("mail.fetch", { mailbox: sub.mailbox, messageId: n.resourceData.id }, { dedupeKey: `fetch:${sub.mailbox}:${n.resourceData.id}` });
    }
    accepted++;
  }
  return accepted;
}

// ---------------------------------------------------------------------------
// Worker jobs
// ---------------------------------------------------------------------------

/** Mailboxes to keep subscribed: the shared one, plus everyone who has granted delegated consent. */
async function desiredMailboxes() {
  const users = await db
    .select({ id: s.users.id, email: s.users.email })
    .from(s.userOauthTokens)
    .innerJoin(s.users, eq(s.users.id, s.userOauthTokens.userId))
    .where(eq(s.users.active, true));
  const out = new Map<string, string | null>(users.map((u) => [u.email.toLowerCase(), u.id]));
  if (sharedMailbox()) out.set(sharedMailbox(), null);
  return out;
}

export async function ensureSubscriptions(now = new Date()): Promise<{ created: number; renewed: number; removed: number; skipped?: string }> {
  if (!appUrl().startsWith("https://")) return { created: 0, renewed: 0, removed: 0, skipped: "Graph notifications need a public https APP_URL" };
  const want = await desiredMailboxes();
  const have = await db.query.graphSubscriptions.findMany();
  const result = { created: 0, renewed: 0, removed: 0 };
  const expiresAt = new Date(now.getTime() + SUBSCRIPTION_MINUTES * 60_000);
  for (const sub of have) {
    if (!want.has(sub.mailbox)) {
      await m365().subscriptions.remove(sub.mailbox, sub.id).catch(() => {});
      await db.delete(s.graphSubscriptions).where(eq(s.graphSubscriptions.id, sub.id));
      result.removed++;
    } else if (sub.expiresAt.getTime() - now.getTime() < RENEW_WITHIN_MS) {
      try {
        const r = await m365().subscriptions.renew(sub.mailbox, sub.id, expiresAt);
        await db.update(s.graphSubscriptions).set({ expiresAt: r.expiresAt }).where(eq(s.graphSubscriptions.id, sub.id));
        result.renewed++;
      } catch {
        // Expired or removed on Graph's side: drop it so it's recreated below.
        await db.delete(s.graphSubscriptions).where(eq(s.graphSubscriptions.id, sub.id));
      }
    }
  }
  const current = new Set((await db.query.graphSubscriptions.findMany()).map((x) => x.mailbox));
  for (const [mailbox, userId] of want) {
    if (current.has(mailbox)) continue;
    const clientState = randomBytes(32).toString("base64url");
    const sub = await m365().subscriptions.createMail({
      mailbox,
      notificationUrl: `${appUrl()}/api/graph/notifications`,
      lifecycleNotificationUrl: `${appUrl()}/api/graph/notifications`,
      clientState,
      expiresAt,
    });
    await db.insert(s.graphSubscriptions).values({ id: sub.id, mailbox, userId, clientStateHash: sha256(clientState), expiresAt: sub.expiresAt });
    result.created++;
  }
  return result;
}

export async function syncMailbox(mailbox: string, now = new Date()) {
  const state = await db.query.mailSyncState.findFirst({ where: eq(s.mailSyncState.mailbox, mailbox) });
  // First sync looks back one day; after that the delta link carries the position.
  const { messages, deltaLink } = await m365().mail.delta(mailbox, state?.deltaLink ?? null, new Date(now.getTime() - 86_400_000));
  let imported = 0;
  for (const m of messages) if ((await ingestInboundMessage(mailbox, m)).status === "imported") imported++;
  await db
    .insert(s.mailSyncState)
    .values({ mailbox, deltaLink, lastSyncedAt: now })
    .onConflictDoUpdate({ target: s.mailSyncState.mailbox, set: { deltaLink, lastSyncedAt: now } });
  return { messages: messages.length, imported };
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export const mailSyncHandlers: Record<string, JobHandler> = {
  async "mail.fetch"(job: ClaimedJob) {
    const mailbox = str(job.payload.mailbox);
    const msg = await m365().mail.getMessage(mailbox, str(job.payload.messageId));
    if (msg) await ingestInboundMessage(mailbox, msg);
  },
  async "mail.delta"(job: ClaimedJob) {
    const only = str(job.payload.mailbox);
    const boxes = only ? [only] : [...(await desiredMailboxes()).keys()];
    for (const b of boxes) await syncMailbox(b);
  },
  async "graph.subscriptions.ensure"() {
    await ensureSubscriptions();
  },
};

/** Called by the worker each tick: schedules the periodic jobs (deduplicated per time bucket). */
export async function schedulePeriodicMailJobs(now = new Date()) {
  if (!m365Configured()) return;
  const quarter = Math.floor(now.getTime() / (15 * 60_000));
  const hour = Math.floor(now.getTime() / 3_600_000);
  await queue().enqueue("mail.delta", {}, { dedupeKey: `mail.delta:${quarter}` });
  await queue().enqueue("graph.subscriptions.ensure", {}, { dedupeKey: `subs:${hour}` });
}

/** Subscriptions and sync state, for Settings → Integrations. */
export async function mailSyncStatus() {
  const [subs, states] = await Promise.all([db.query.graphSubscriptions.findMany(), db.query.mailSyncState.findMany()]);
  const expiring = subs.filter((x) => x.expiresAt.getTime() < Date.now() + RENEW_WITHIN_MS).length;
  return { subscriptions: subs.length, expiring, mailboxes: states.length, lastSyncedAt: states.map((x) => x.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null };
}

/** Removes delta positions for mailboxes nobody syncs any more. */
export async function pruneSyncState(olderThanDays = 30) {
  await db.delete(s.mailSyncState).where(lt(s.mailSyncState.lastSyncedAt, new Date(Date.now() - olderThanDays * 86_400_000)));
}

// ---------------------------------------------------------------------------
// Demo: simulate a candidate reply (mock mode only)
// ---------------------------------------------------------------------------

export function canSimulateReplies() {
  return !m365Configured() && process.env.NODE_ENV !== "production";
}

/**
 * In mock mode there is no real inbox, so demos can make the candidate "reply" to an email. It goes
 * through the same ingest path a synced Graph message does.
 */
export async function simulateCandidateReply(actor: UserActor, emailId: string) {
  if (!canSimulateReplies()) throw new ForbiddenError("Replies come from Outlook when Microsoft 365 is connected.");
  const email = await db.query.emails.findFirst({ where: and(eq(s.emails.id, emailId), eq(s.emails.direction, "outbound")) });
  if (!email) throw new NotFoundError("Email");
  if (email.applicationId) {
    const app = await db.query.applications.findFirst({ where: eq(s.applications.id, email.applicationId) });
    await assertCanSeeJobs(actor, [app!.jobId]);
  } else if (!canManageRecruiting(actor)) throw new NotFoundError("Email");
  const cand = await db.query.candidates.findFirst({ where: eq(s.candidates.id, email.candidateId) });
  if (!cand?.email) throw new NotFoundError("Candidate");
  let threadId = email.externalThreadId;
  if (!threadId) {
    // Mail recorded before thread ids were kept: give it one so the reply has a conversation.
    threadId = `mock-thread-${email.id}`;
    await db.update(s.emails).set({ externalThreadId: threadId }).where(eq(s.emails.id, email.id));
  }
  return ingestInboundMessage(
    email.fromAddress,
    {
      id: `sim-${randomBytes(8).toString("hex")}`,
      internetMessageId: `<sim-${randomBytes(12).toString("hex")}@mock.pats>`,
      conversationId: threadId,
      from: cand.email,
      to: [email.fromAddress],
      subject: email.subject.startsWith("RE:") ? email.subject : `RE: ${email.subject}`,
      bodyText: `Hi,\n\nThanks for getting in touch. I'm free Tuesday or Wednesday afternoon this week.\n\nBest,\n${cand.firstName}`,
      receivedAt: new Date(),
    },
    actor,
  );
}
