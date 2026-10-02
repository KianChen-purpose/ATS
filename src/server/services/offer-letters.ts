import "server-only";
import { and, asc, desc, eq, isNull, or } from "drizzle-orm";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { fileStore } from "@/server/integrations/files";
import { assertCanSeeJobs, ForbiddenError, NotFoundError, requireRecruiting, requireUserActor, type Actor } from "@/server/policy";
import { recordAudit } from "./audit";
import { storeFile } from "./files";

/**
 * Word offer letters (PRD §4.5): .docx templates with merge fields, scoped by brand and
 * language, rendered with docxtemplater. Generated letters go through the FileStore.
 */

export const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Merge fields available in templates, e.g. {candidate_first_name}. Sections: {#bonus}…{/bonus}. */
export const MERGE_FIELDS = {
  candidate_first_name: "Candidate first name",
  candidate_last_name: "Candidate last name",
  candidate_full_name: "Candidate full name",
  job_title: "Job title",
  brand_name: "Brand",
  base_salary: "Base salary, formatted for the letter's language",
  bonus_percent: "Target bonus % (inside {#bonus}…{/bonus})",
  sign_on_bonus: "Sign-on bonus (inside {#sign_on}…{/sign_on})",
  equity: "Equity / LTIP terms (inside {#equity_terms}…{/equity_terms})",
  start_date: "Start date (inside {#start}…{/start})",
  today: "Today's date",
  sender_name: "Recruiter's name",
} as const;

function render(template: Buffer, data: Record<string, unknown>) {
  const doc = new Docxtemplater(new PizZip(template), { paragraphLoop: true, linebreaks: true, nullGetter: () => "" });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

/** Throws a readable error if the file isn't a valid .docx template. */
function validateTemplate(bytes: Buffer) {
  try {
    render(bytes, {});
  } catch (e) {
    const detail = (e as { properties?: { errors?: { properties?: { explanation?: string } }[] } }).properties?.errors?.[0]?.properties?.explanation;
    throw new Error(`That isn't a valid offer letter template${detail ? `: ${detail}` : "."}`);
  }
}

// ---------------------------------------------------------------------------
// Templates (admin)
// ---------------------------------------------------------------------------

function requireTemplateAdmin(actor: Actor) {
  const u = requireUserActor(actor);
  if (u.role !== "admin") throw new ForbiddenError("Only admins can manage offer letter templates.");
  return u;
}

export async function listTemplates(actor: Actor) {
  requireTemplateAdmin(actor);
  return db.query.offerLetterTemplates.findMany({
    orderBy: [asc(s.offerLetterTemplates.name)],
    with: { brand: true, file: true },
  });
}

export const templateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  brandId: z.string().uuid().nullable(),
  locale: z.enum(s.locale.enumValues),
});

export async function uploadTemplate(actor: Actor, d: z.output<typeof templateSchema> & { fileName: string; bytes: Buffer }) {
  requireTemplateAdmin(actor);
  if (!d.fileName.toLowerCase().endsWith(".docx")) throw new Error("Upload a Word .docx file.");
  if (d.bytes.length > 5 * 1024 * 1024) throw new Error("Templates must be under 5 MB.");
  validateTemplate(d.bytes);
  return db.transaction(async (tx) => {
    const file = await storeFile(tx, actor, { kind: "offer_letter_template", fileName: d.fileName, contentType: DOCX, bytes: d.bytes, brandId: d.brandId });
    const [tpl] = await tx.insert(s.offerLetterTemplates).values({ name: d.name, brandId: d.brandId, locale: d.locale, fileId: file.id, createdById: actor.kind === "user" ? actor.id : null }).returning();
    await recordAudit(tx, actor, "offer_letter_template.created", "offer_letter_template", tpl.id, { brandId: d.brandId, locale: d.locale });
    return tpl;
  });
}

export async function setTemplateActive(actor: Actor, templateId: string, active: boolean) {
  requireTemplateAdmin(actor);
  await db.transaction(async (tx) => {
    const [row] = await tx.update(s.offerLetterTemplates).set({ active }).where(eq(s.offerLetterTemplates.id, templateId)).returning();
    if (!row) throw new NotFoundError("Template");
    await recordAudit(tx, actor, active ? "offer_letter_template.activated" : "offer_letter_template.deactivated", "offer_letter_template", templateId);
  });
}

/** Brand + language first, then all-brands in that language, then English fallbacks. */
export async function pickTemplate(brandId: string, locale: (typeof s.locale.enumValues)[number]) {
  const rows = await db.query.offerLetterTemplates.findMany({
    where: and(eq(s.offerLetterTemplates.active, true), or(eq(s.offerLetterTemplates.brandId, brandId), isNull(s.offerLetterTemplates.brandId))),
    orderBy: desc(s.offerLetterTemplates.createdAt),
    with: { file: true },
  });
  const rank = (t: (typeof rows)[number]) => (t.locale === locale ? 0 : 2) + (t.brandId ? 0 : 1);
  return rows.filter((t) => t.locale === locale || t.locale === "en").sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function letterData(
  o: { baseSalary: number; bonusPercent: number | null; signOnBonus: number | null; equity: string | null; currency: string; startDate: string | null },
  c: { firstName: string; lastName: string },
  job: { title: string; brand: string },
  sender: string,
  locale: "en" | "fr-CA",
) {
  // Canadian formats: en-CA shows "$133,000" (not "CA$"), fr-CA "133 000 $".
  const intl = locale === "fr-CA" ? "fr-CA" : "en-CA";
  const money = (n: number) => new Intl.NumberFormat(intl, { style: "currency", currency: o.currency, maximumFractionDigits: 0 }).format(n);
  const date = (d: Date) => new Intl.DateTimeFormat(intl, { dateStyle: "long", timeZone: "America/Toronto" }).format(d);
  return {
    candidate_first_name: c.firstName,
    candidate_last_name: c.lastName,
    candidate_full_name: `${c.firstName} ${c.lastName}`,
    job_title: job.title,
    brand_name: job.brand,
    base_salary: money(o.baseSalary),
    bonus: o.bonusPercent ? { bonus_percent: o.bonusPercent } : false,
    sign_on: o.signOnBonus ? { sign_on_bonus: money(o.signOnBonus) } : false,
    equity_terms: o.equity ? { equity: o.equity } : false,
    start: o.startDate ? { start_date: date(new Date(o.startDate + "T12:00:00Z")) } : false,
    today: date(new Date()),
    sender_name: sender,
  };
}

/** Render the offer's letter from the best template and store it on the offer. */
export async function generateOfferLetter(actor: Actor, offerId: string) {
  const user = requireRecruiting(actor, "You don't have permission to generate offer letters.");
  const offer = await db.query.offers.findFirst({
    where: eq(s.offers.id, offerId),
    with: { application: { with: { candidate: true, job: { with: { brand: true } } } } },
  });
  if (!offer) throw new NotFoundError("Offer");
  await assertCanSeeJobs(actor, [offer.application.jobId]);
  if (!["approved", "sent"].includes(offer.status)) throw new Error("Letters are generated for approved offers.");
  const { candidate: c, job } = offer.application;
  const tpl = await pickTemplate(job.brandId, c.preferredLocale);
  if (!tpl) throw new Error(`No active offer letter template for ${job.brand.name}. An admin can add one in Settings → Offer letters.`);
  const template = await fileStore().get(tpl.file.storageKey);
  const bytes = render(template, letterData(offer, c, { title: job.title, brand: job.brand.name }, user.name, tpl.locale));
  const fileName = `Offer - ${c.firstName} ${c.lastName} - ${job.title}.docx`.replace(/[\\/:*?"<>|]/g, "");

  return db.transaction(async (tx) => {
    const file = await storeFile(tx, actor, {
      kind: "offer_letter",
      fileName,
      contentType: DOCX,
      bytes,
      jobId: job.id,
      applicationId: offer.applicationId,
      candidateId: c.id,
      brandId: job.brandId,
    });
    await tx.update(s.offers).set({ letterFileId: file.id, updatedAt: new Date() }).where(eq(s.offers.id, offer.id));
    await recordAudit(tx, actor, "offer_letter.generated", "offer", offer.id, { fileId: file.id, templateId: tpl.id, locale: tpl.locale });
    return { file, bytes };
  });
}
