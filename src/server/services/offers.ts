import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { fmt } from "@/lib/utils";
import {
  assertCanSeeJobs,
  canViewCompensation,
  NotFoundError,
  requireRecruiting,
  visibleJobIds,
  type Actor,
  type UserActor,
} from "@/server/policy";
import { applyStageMove } from "./applications";
import { cancelPendingApprovals, latestApprovals, notifyApprover, startApproval } from "./approvals";
import { recordAudit } from "./audit";
import { sendAndLogEmail } from "./email";
import { generateOfferLetter } from "./offer-letters";
import type { Tx } from "./tx";

/**
 * Offers (PRD §4.5). Compensation is a restricted field (ARCHITECTURE.md §3.5): only recruiting
 * roles create and change offers, and only roles that can see compensation read them.
 *
 *   draft ──submit──▶ pending_approval ──approved──▶ approved ──send──▶ sent ──▶ accepted | declined
 *     ▲                      │ rejected
 *     └──────────────────────┘          (withdrawn from any state before accepted/declined)
 */

type OfferStatus = (typeof s.offerStatus.enumValues)[number];
const LIVE: OfferStatus[] = ["draft", "pending_approval", "approved", "sent"];
const FINAL: OfferStatus[] = ["accepted", "declined", "withdrawn"];

async function loadOffer(actor: Actor, offerId: string) {
  const offer = await db.query.offers.findFirst({
    where: eq(s.offers.id, offerId),
    with: { application: { with: { candidate: true, stage: true, job: { with: { brand: true, stages: { orderBy: asc(s.jobStages.position) } } } } } },
  });
  if (!offer) throw new NotFoundError("Offer");
  await assertCanSeeJobs(actor, [offer.application.jobId]);
  return offer;
}

function approvalContext(offer: Awaited<ReturnType<typeof loadOffer>>) {
  const j = offer.application.job;
  return { job: { id: j.id, brandId: j.brandId, departmentId: j.departmentId, hiringManagerId: j.hiringManagerId, recruiterId: j.recruiterId }, amount: offer.baseSalary };
}

// ---------------------------------------------------------------------------
// Create & edit
// ---------------------------------------------------------------------------

const dollars = z.number().int().min(0).max(10_000_000);
export const offerTermsSchema = z.object({
  baseSalary: dollars.min(1, "Base salary is required"),
  bonusPercent: z.number().int().min(0).max(200).nullable(),
  signOnBonus: dollars.nullable(),
  equity: z.string().trim().max(2000).nullable(),
  currency: z.enum(["CAD", "USD"]).default("CAD"),
  startDate: z.string().date().nullable(),
  openingId: z.string().uuid().nullable(),
  notes: z.string().trim().max(5000).nullable(),
});
export const createOfferSchema = offerTermsSchema.extend({ applicationId: z.string().uuid() });

async function checkOpening(tx: Tx, jobId: string, openingId: string | null) {
  if (!openingId) return;
  const o = await tx.query.openings.findFirst({ where: and(eq(s.openings.id, openingId), eq(s.openings.jobId, jobId)) });
  if (!o) throw new NotFoundError("Opening");
  if (o.status !== "open") throw new Error(`Opening ${o.code} isn't open.`);
}

export async function createOffer(actor: Actor, d: z.output<typeof createOfferSchema>) {
  const user = requireRecruiting(actor, "You don't have permission to create offers.");
  const app = await db.query.applications.findFirst({ where: eq(s.applications.id, d.applicationId) });
  if (!app) throw new NotFoundError("Application");
  await assertCanSeeJobs(actor, [app.jobId]);
  if (app.status !== "active") throw new Error("Offers can only be made on active applications.");

  return db.transaction(async (tx) => {
    const live = await tx.query.offers.findFirst({ where: and(eq(s.offers.applicationId, app.id), inArray(s.offers.status, LIVE)) });
    if (live) throw new Error("This application already has an offer in progress.");
    await checkOpening(tx, app.jobId, d.openingId);
    const { applicationId, ...terms } = d;
    const [offer] = await tx.insert(s.offers).values({ ...terms, applicationId, createdById: user.id }).returning();
    await tx.insert(s.activities).values({
      candidateId: app.candidateId,
      applicationId: app.id,
      type: "offer_created",
      actorId: user.id,
      body: "Created an offer draft",
      metadata: { offerId: offer.id },
    });
    await recordAudit(tx, actor, "offer.created", "offer", offer.id, { applicationId: app.id });
    return offer;
  });
}

/** Edit terms. Only drafts can change; a submitted offer must be withdrawn to draft first. */
export async function updateOffer(actor: Actor, offerId: string, d: z.output<typeof offerTermsSchema>) {
  requireRecruiting(actor, "You don't have permission to change offers.");
  const offer = await loadOffer(actor, offerId);
  if (offer.status !== "draft") throw new Error("Only draft offers can be edited.");
  await db.transaction(async (tx) => {
    await checkOpening(tx, offer.application.jobId, d.openingId);
    await tx.update(s.offers).set({ ...d, updatedAt: new Date() }).where(eq(s.offers.id, offerId));
    // Field names only: the values are compensation.
    await recordAudit(tx, actor, "offer.updated", "offer", offerId, { fields: Object.keys(d) });
  });
}

// ---------------------------------------------------------------------------
// Approval
// ---------------------------------------------------------------------------

/** Submit a draft for approval. With no applicable chain it's approved straight away. */
export async function submitOffer(actor: Actor, offerId: string) {
  const user = requireRecruiting(actor, "You don't have permission to submit offers.");
  const offer = await loadOffer(actor, offerId);
  if (offer.status !== "draft") throw new Error("Only draft offers can be submitted.");
  const started = await db.transaction(async (tx) => {
    const r = await startApproval(tx, actor, "offer", offer.id, approvalContext(offer));
    const status: OfferStatus = r ? "pending_approval" : "approved";
    await tx.update(s.offers).set({ status, updatedAt: new Date() }).where(eq(s.offers.id, offer.id));
    await tx.insert(s.activities).values({
      candidateId: offer.application.candidateId,
      applicationId: offer.applicationId,
      type: "offer_created",
      actorId: user.id,
      body: r ? "Submitted the offer for approval" : "Offer approved (no approval needed)",
      metadata: { offerId: offer.id },
    });
    await recordAudit(tx, actor, "offer.submitted", "offer", offer.id, { approvalRequestId: r?.request.id ?? null });
    return r;
  });
  if (started) {
    const c = offer.application.candidate;
    await notifyApprover(started.firstApproverId, "Offer approval needed", `${c.firstName} ${c.lastName} · ${offer.application.job.title}`, "/approvals");
  }
  return { status: started ? ("pending_approval" as const) : ("approved" as const) };
}

/** Apply a finished offer approval (called by the approval flow inside its transaction). */
export async function applyOfferApprovalOutcome(tx: Tx, actor: Actor, offerId: string, outcome: "approved" | "rejected") {
  const offer = await tx.query.offers.findFirst({ where: eq(s.offers.id, offerId), with: { application: true } });
  if (!offer || offer.status !== "pending_approval") return offer ?? null;
  const status: OfferStatus = outcome === "approved" ? "approved" : "draft";
  await tx.update(s.offers).set({ status, updatedAt: new Date() }).where(eq(s.offers.id, offerId));
  await tx.insert(s.activities).values({
    candidateId: offer.application.candidateId,
    applicationId: offer.applicationId,
    type: "offer_created",
    actorId: actor.kind === "user" ? actor.id : null,
    body: outcome === "approved" ? "Offer approved" : "Offer approval was rejected; back to draft",
    metadata: { offerId },
  });
  await recordAudit(tx, actor, "offer.status_changed", "offer", offerId, { from: "pending_approval", to: status, via: "approval" });
  return offer;
}

// ---------------------------------------------------------------------------
// Send, respond, withdraw
// ---------------------------------------------------------------------------

/** Candidate-facing offer email, in the candidate's language (ARCHITECTURE.md §7.2). */
function offerEmail(locale: "en" | "fr-CA", v: { firstName: string; jobTitle: string; brand: string; sender: string; startDate: string | null }) {
  if (locale === "fr-CA") {
    return {
      subject: `Votre offre d'emploi – ${v.jobTitle}, ${v.brand}`,
      body: `Bonjour ${v.firstName},\n\nNous avons le plaisir de vous présenter une offre pour le poste de ${v.jobTitle} chez ${v.brand}.${v.startDate ? ` La date d'entrée en fonction proposée est le ${v.startDate}.` : ""} Vous trouverez les détails dans la lettre d'offre jointe.\n\nN'hésitez pas à me répondre si vous avez des questions.\n\n${v.sender}`,
    };
  }
  return {
    subject: `Your offer – ${v.jobTitle}, ${v.brand}`,
    body: `Hi ${v.firstName},\n\nWe're delighted to offer you the ${v.jobTitle} role at ${v.brand}.${v.startDate ? ` The proposed start date is ${v.startDate}.` : ""} The details are in the attached offer letter.\n\nReply to this email with any questions.\n\n${v.sender}`,
  };
}

/** Email an approved offer to the candidate and mark it sent. */
export async function sendOffer(actor: Actor, offerId: string) {
  const user = requireRecruiting(actor, "You don't have permission to send offers.");
  const offer = await loadOffer(actor, offerId);
  if (offer.status !== "approved") throw new Error("Only approved offers can be sent.");
  const c = offer.application.candidate;
  if (!c.email) throw new Error("Candidate has no email address.");
  const locale = c.preferredLocale;
  const mail = offerEmail(locale, {
    firstName: c.firstName,
    jobTitle: offer.application.job.title,
    brand: offer.application.job.brand.name,
    sender: user.name,
    startDate: offer.startDate ? fmt(offer.startDate + "T12:00:00Z", locale === "fr-CA" ? "d MMMM yyyy" : "MMMM d, yyyy") : null,
  });
  // A fresh letter for the current terms, attached to the email.
  const letter = await generateOfferLetter(actor, offer.id);
  // Send first; if the email fails the offer stays "approved" and can be retried.
  await sendAndLogEmail(actor, {
    candidateId: c.id,
    applicationId: offer.applicationId,
    from: user.email,
    to: c.email,
    subject: mail.subject,
    body: mail.body,
    auditAction: "offer.email_sent",
    attachments: [{ fileId: letter.file.id, name: letter.file.fileName, contentType: letter.file.contentType, bytes: letter.bytes }],
  });
  await db.transaction((tx) => markOfferSent(tx, user, offer.id));
  return { candidateId: c.id };
}

/** Record that an approved offer was sent (inside the caller's transaction). */
export async function markOfferSent(tx: Tx, actor: UserActor, offerId: string) {
  const [row] = await tx
    .update(s.offers)
    .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
    .where(and(eq(s.offers.id, offerId), eq(s.offers.status, "approved")))
    .returning();
  if (!row) throw new Error("Only approved offers can be sent.");
  await recordAudit(tx, actor, "offer.sent", "offer", offerId);
  return row;
}

export const responseSchema = z.object({
  offerId: z.string().uuid(),
  response: z.enum(["accepted", "declined"]),
  declineReason: z.string().trim().max(2000).optional(),
});

/**
 * Record the candidate's answer. Accepting hires the application (one stage event) and fills
 * the offer's opening, or the job's next open one.
 */
export async function recordOfferResponse(actor: Actor, d: z.output<typeof responseSchema>) {
  const user = requireRecruiting(actor, "You don't have permission to record offer responses.");
  const offer = await loadOffer(actor, d.offerId);
  if (offer.status !== "sent") throw new Error("Only sent offers can be accepted or declined.");
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(s.offers)
      .set({ status: d.response, decidedAt: now, declineReason: d.response === "declined" ? d.declineReason || null : null, updatedAt: now })
      .where(eq(s.offers.id, offer.id));
    await recordAudit(tx, actor, `offer.${d.response}`, "offer", offer.id, d.response === "declined" ? { hasReason: Boolean(d.declineReason) } : {});
    const app = offer.application;
    await tx.insert(s.activities).values({
      candidateId: app.candidateId,
      applicationId: app.id,
      type: "offer_created",
      actorId: user.id,
      body: d.response === "accepted" ? "Offer accepted 🎉" : `Offer declined${d.declineReason ? `: ${d.declineReason}` : ""}`,
      metadata: { offerId: offer.id },
    });

    if (d.response === "accepted") {
      const hired = app.job.stages.find((st) => st.type === "hired");
      if (!hired) throw new Error("This job has no Hired stage.");
      await applyStageMove(tx, user, app, hired, now);
      const opening = offer.openingId
        ? await tx.query.openings.findFirst({ where: and(eq(s.openings.id, offer.openingId), eq(s.openings.status, "open")) })
        : await tx.query.openings.findFirst({
            where: and(eq(s.openings.jobId, app.jobId), eq(s.openings.status, "open")),
            orderBy: [asc(s.openings.targetStartDate), asc(s.openings.code)],
          });
      if (opening) {
        await tx.update(s.openings).set({ status: "filled", filledAt: now }).where(eq(s.openings.id, opening.id));
        if (!offer.openingId) await tx.update(s.offers).set({ openingId: opening.id }).where(eq(s.offers.id, offer.id));
        await recordAudit(tx, actor, "opening.filled", "opening", opening.id, { offerId: offer.id, applicationId: app.id });
      }
    }
  });
  return { candidateId: offer.application.candidateId, jobId: offer.application.jobId };
}

export async function withdrawOffer(actor: Actor, offerId: string) {
  const user = requireRecruiting(actor, "You don't have permission to withdraw offers.");
  const offer = await loadOffer(actor, offerId);
  if (FINAL.includes(offer.status)) throw new Error("This offer is already closed.");
  await db.transaction(async (tx) => {
    await cancelPendingApprovals(tx, actor, "offer", offer.id);
    await tx.update(s.offers).set({ status: "withdrawn", decidedAt: new Date(), updatedAt: new Date() }).where(eq(s.offers.id, offer.id));
    await tx.insert(s.activities).values({
      candidateId: offer.application.candidateId,
      applicationId: offer.applicationId,
      type: "offer_created",
      actorId: user.id,
      body: "Offer withdrawn",
      metadata: { offerId: offer.id },
    });
    await recordAudit(tx, actor, "offer.withdrawn", "offer", offer.id, { from: offer.status });
  });
  return { candidateId: offer.application.candidateId };
}

/** Pull a pending offer back to draft so it can be edited (cancels the approval run). */
export async function returnOfferToDraft(actor: Actor, offerId: string) {
  requireRecruiting(actor, "You don't have permission to change offers.");
  const offer = await loadOffer(actor, offerId);
  if (!["pending_approval", "approved"].includes(offer.status)) throw new Error("Only submitted offers can go back to draft.");
  await db.transaction(async (tx) => {
    await cancelPendingApprovals(tx, actor, "offer", offer.id);
    await tx.update(s.offers).set({ status: "draft", updatedAt: new Date() }).where(eq(s.offers.id, offer.id));
    await recordAudit(tx, actor, "offer.status_changed", "offer", offer.id, { from: offer.status, to: "draft" });
  });
  return { candidateId: offer.application.candidateId };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type OfferListView = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "closed";

const VIEW_STATUSES: Record<OfferListView, OfferStatus[]> = {
  draft: ["draft"],
  pending_approval: ["pending_approval"],
  approved: ["approved"],
  sent: ["sent"],
  accepted: ["accepted"],
  closed: ["declined", "withdrawn"],
};

/** Offers on jobs the actor can see. Empty for roles that can't see compensation. */
export async function listOffers(actor: UserActor, view: OfferListView) {
  if (!canViewCompensation(actor)) return { rows: [], counts: {} as Record<OfferListView, number> };
  const visible = sql`${s.applications.jobId} IN (${visibleJobIds(actor)})`;
  const [rows, countRows] = await Promise.all([
    db
      .select({
        id: s.offers.id,
        status: s.offers.status,
        baseSalary: s.offers.baseSalary,
        bonusPercent: s.offers.bonusPercent,
        currency: s.offers.currency,
        startDate: s.offers.startDate,
        createdAt: s.offers.createdAt,
        sentAt: s.offers.sentAt,
        decidedAt: s.offers.decidedAt,
        applicationId: s.applications.id,
        candidateId: s.candidates.id,
        firstName: s.candidates.firstName,
        lastName: s.candidates.lastName,
        jobId: s.jobs.id,
        jobTitle: s.jobs.title,
        brand: s.brands.name,
        compMin: s.jobs.compMin,
        compMax: s.jobs.compMax,
      })
      .from(s.offers)
      .innerJoin(s.applications, eq(s.applications.id, s.offers.applicationId))
      .innerJoin(s.candidates, eq(s.candidates.id, s.applications.candidateId))
      .innerJoin(s.jobs, eq(s.jobs.id, s.applications.jobId))
      .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
      .where(and(visible, inArray(s.offers.status, VIEW_STATUSES[view])))
      .orderBy(desc(s.offers.updatedAt))
      .limit(200),
    db
      .select({ status: s.offers.status, n: sql<number>`count(*)::int` })
      .from(s.offers)
      .innerJoin(s.applications, eq(s.applications.id, s.offers.applicationId))
      .where(visible)
      .groupBy(s.offers.status),
  ]);
  const byStatus = Object.fromEntries(countRows.map((r) => [r.status, r.n])) as Partial<Record<OfferStatus, number>>;
  const counts = Object.fromEntries(
    (Object.keys(VIEW_STATUSES) as OfferListView[]).map((v) => [v, VIEW_STATUSES[v].reduce((n, st) => n + (byStatus[st] ?? 0), 0)]),
  ) as Record<OfferListView, number>;
  const approvals = await latestApprovals("offer", rows.map((r) => r.id));
  return { rows: rows.map((r) => ({ ...r, approval: approvals.get(r.id) ?? null })), counts };
}

/** Open openings for a job, for the offer form. */
export async function openOpenings(actor: UserActor, jobId: string) {
  await assertCanSeeJobs(actor, [jobId]);
  return db
    .select({ id: s.openings.id, code: s.openings.code, targetStartDate: s.openings.targetStartDate })
    .from(s.openings)
    .where(and(eq(s.openings.jobId, jobId), eq(s.openings.status, "open")))
    .orderBy(asc(s.openings.code));
}

