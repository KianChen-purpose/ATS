import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import PizZip from "pizzip";
import { db, schema as s } from "@/db";
import { buildDefaultLetterTemplate } from "@/db/letter-templates";
import { fileStore } from "@/server/integrations/files";
import { userActor } from "@/server/policy";
import { downloadFile } from "@/server/services/files";
import * as letters from "@/server/services/offer-letters";
import * as offers from "@/server/services/offers";
import * as privacy from "@/server/services/privacy";
import { makeApplication, makeBrand, makeCandidate, makeJob, makeUser, resetDb } from "./fixtures";

const docText = (bytes: Buffer) =>
  new PizZip(bytes)
    .file("word/document.xml")!
    .asText()
    .replace(/<[^>]+>/g, "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

async function world(locale: "en" | "fr-CA" = "en") {
  const admin = userActor(await makeUser("admin"));
  const rec = userActor(await makeUser("recruiter", "Maya Recruiter"));
  const iv = userActor(await makeUser("interviewer"));
  const brand = await makeBrand();
  for (const l of ["en", "fr-CA"] as const) {
    await letters.uploadTemplate(admin, { name: `Default ${l}`, brandId: null, locale: l, fileName: `${l}.docx`, bytes: await buildDefaultLetterTemplate(l) });
  }
  const job = await makeJob({ brandId: brand.id, recruiterId: rec.id, team: [iv.id], title: "Portfolio Analyst" });
  const cand = await makeCandidate({ firstName: "Amélie", lastName: "Tremblay", email: "amelie@example.org", preferredLocale: locale });
  const app = await makeApplication(cand.id, job);
  const offer = await offers.createOffer(
    rec,
    offers.createOfferSchema.parse({ applicationId: app.id, baseSalary: 125_000, bonusPercent: 12, signOnBonus: null, equity: "1,500 RSUs over 4 years", startDate: "2027-01-04", openingId: null, notes: null }),
  );
  await offers.submitOffer(rec, offer.id); // no offer chain configured → approved
  return { admin, rec, iv, brand, job, cand, app, offer };
}

describe("offer letters", () => {
  beforeEach(resetDb);

  it("renders the candidate's language with merge fields and optional sections", async () => {
    const w = await world("fr-CA");
    const { file, bytes } = await letters.generateOfferLetter(w.rec, w.offer.id);
    const text = docText(bytes);
    expect(text).toContain("Offre d'emploi");
    expect(text).toContain("Bonjour Amélie");
    expect(text).toContain("Portfolio Analyst");
    expect(text).toMatch(/125\s000\s\$/); // fr-CA money format (narrow no-break spaces)
    expect(text).toContain("12 %");
    expect(text).toContain("1,500 RSUs over 4 years");
    expect(text).not.toContain("Prime à la signature"); // no sign-on bonus → section removed
    expect(text).not.toMatch(/\{[a-z_#/]+\}/); // no unfilled tags
    expect(file).toMatchObject({ kind: "offer_letter", jobId: w.job.job.id, applicationId: w.app.id, candidateId: w.cand.id });
    expect((await db.query.offers.findFirst({ where: eq(s.offers.id, w.offer.id) }))?.letterFileId).toBe(file.id);
  });

  it("formats English letters in Canadian style", async () => {
    const w = await world("en");
    const text = docText((await letters.generateOfferLetter(w.rec, w.offer.id)).bytes);
    expect(text).toContain("Base salary: $125,000 per year");
    expect(text).toContain("Dear Amélie");
    expect(text).not.toContain("CA$");
  });

  it("prefers a brand-specific template over the all-brands one", async () => {
    const w = await world("en");
    const branded = Buffer.from(await buildDefaultLetterTemplate("en"));
    const tpl = await letters.uploadTemplate(w.admin, { name: "Brand EN", brandId: w.brand.id, locale: "en", fileName: "brand.docx", bytes: branded });
    expect((await letters.pickTemplate(w.brand.id, "en"))?.id).toBe(tpl.id);
    expect((await letters.pickTemplate(w.brand.id, "fr-CA"))?.locale).toBe("fr-CA");
    await letters.setTemplateActive(w.admin, tpl.id, false);
    expect((await letters.pickTemplate(w.brand.id, "en"))?.brandId).toBeNull();
  });

  it("sending attaches the letter; the email row keeps only file metadata", async () => {
    const w = await world("en");
    await offers.sendOffer(w.rec, w.offer.id);
    const [email] = await db.query.emails.findMany({ where: eq(s.emails.applicationId, w.app.id) });
    expect(email.attachments).toHaveLength(1);
    expect(email.attachments[0].name).toMatch(/^Offer - Amélie Tremblay - Portfolio Analyst\.docx$/);
    const events = JSON.stringify(await db.query.integrationEvents.findMany());
    expect(events).toContain('"attachments":1');
    expect(events).not.toContain("Amélie");
  });

  it("downloads follow job visibility and the compensation rule, and are audited", async () => {
    const w = await world("en");
    const { file } = await letters.generateOfferLetter(w.rec, w.offer.id);
    const got = await downloadFile(w.rec, file.id);
    expect(got.bytes.length).toBe(file.sizeBytes);
    await expect(downloadFile(w.iv, file.id)).rejects.toThrow(/permission/); // on the team but can't see comp
    const outsider = userActor(await makeUser("hiring_manager"));
    await expect(downloadFile(outsider, file.id)).rejects.toThrow(/not found/);
    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, file.id) });
    expect(audit.map((a) => a.action)).toEqual(["file.exported"]);
  });

  it("only admins upload templates, and bad files are rejected", async () => {
    const w = await world("en");
    const bytes = await buildDefaultLetterTemplate("en");
    await expect(letters.uploadTemplate(w.rec, { name: "x", brandId: null, locale: "en", fileName: "x.docx", bytes })).rejects.toThrow(/Only admins/);
    await expect(letters.uploadTemplate(w.admin, { name: "x", brandId: null, locale: "en", fileName: "x.pdf", bytes })).rejects.toThrow(/\.docx/);
    await expect(letters.uploadTemplate(w.admin, { name: "x", brandId: null, locale: "en", fileName: "x.docx", bytes: Buffer.from("not a zip") })).rejects.toThrow(/valid offer letter template/);
  });

  it("anonymizing the candidate removes their letter bytes but keeps the file row", async () => {
    const w = await world("en");
    const { file } = await letters.generateOfferLetter(w.rec, w.offer.id);
    await privacy.anonymizeCandidate(w.admin, w.cand.id, { reason: "deletion_request" });
    const row = await db.query.files.findFirst({ where: eq(s.files.id, file.id) });
    expect(row?.deletedAt).toBeInstanceOf(Date);
    expect(row?.fileName).toBe("[redacted]");
    await expect(fileStore().get(file.storageKey)).rejects.toThrow();
    await expect(downloadFile(w.rec, file.id)).rejects.toThrow(/not found/);
  });
});
