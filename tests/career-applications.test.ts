import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userActor } from "@/server/policy";
import * as forms from "@/server/services/application-forms";
import { applySchema, submitApplication } from "@/server/services/career-applications";
import { downloadFile } from "@/server/services/files";
import * as privacy from "@/server/services/privacy";
import { makeJob, makeUser, resetDb } from "./fixtures";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(200, 32)]);
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(200)]);

async function world() {
  const rec = userActor(await makeUser("recruiter"));
  const { job, stages } = await makeJob({ recruiterId: rec.id, title: "Data Analyst" });
  await db.update(s.jobs).set({ status: "open", publishedOnCareerSite: true }).where(eq(s.jobs.id, job.id));
  await db.insert(s.sources).values({ name: "Career Site", category: "inbound" });
  await db.insert(s.archiveReasons).values({ name: "Knockout question", category: "rejected" });
  const auth = await forms.addQuestion(
    rec,
    forms.questionSchema.parse({ jobId: job.id, kind: "yes_no", labelEn: "Entitled to work in Canada?", labelFr: "Autorisé(e) à travailler au Canada?", required: true, passAnswers: ["yes"] }),
  );
  const heard = await forms.addQuestion(
    rec,
    forms.questionSchema.parse({
      jobId: job.id,
      kind: "single_select",
      labelEn: "How did you hear about us?",
      labelFr: "Comment avez-vous entendu parler de nous?",
      options: [{ value: "linkedin", en: "LinkedIn", fr: "LinkedIn" }, { value: "other", en: "Other", fr: "Autre" }],
    }),
  );
  const apply = (o: Partial<Record<string, unknown>> = {}, resume: { name: string; bytes: Buffer } | null = null) =>
    submitApplication(
      applySchema.parse({
        jobId: job.id,
        locale: "en",
        firstName: "Ada",
        lastName: "Lovelace",
        email: "Ada@Example.org",
        answers: { [auth.id]: "yes", [heard.id]: "linkedin" },
        consentProcessing: true,
        consentTalentPool: false,
        ...o,
      }),
      resume,
    );
  return { rec, job, stages, auth, heard, apply };
}

const appsFor = (jobId: string) => db.query.applications.findMany({ where: eq(s.applications.jobId, jobId) });

describe("career site applications", () => {
  beforeEach(resetDb);

  it("creates candidate, application, stage event, consent, answers, audit and a confirmation", async () => {
    const w = await world();
    expect(await w.apply({ locale: "fr-CA", consentTalentPool: true }, { name: "cv.pdf", bytes: PDF })).toEqual({ ok: true });
    const [app] = await appsFor(w.job.id);
    expect(app).toMatchObject({ status: "active", stageId: w.stages.find((st) => st.type === "review")!.id });
    const cand = await db.query.candidates.findFirst({ where: eq(s.candidates.id, app.candidateId) });
    expect(cand).toMatchObject({ email: "ada@example.org", preferredLocale: "fr-CA", resumeFileName: "cv.pdf" });
    expect(await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, app.id) })).toHaveLength(1);
    const consents = await db.query.consentRecords.findMany({ where: eq(s.consentRecords.candidateId, cand!.id) });
    expect(consents.map((c) => c.purpose).sort()).toEqual(["application_processing", "talent_pool"]);
    expect(consents.every((c) => c.source === "career_site" && c.locale === "fr-CA")).toBe(true);
    expect(await db.query.applicationAnswers.findMany({ where: eq(s.applicationAnswers.applicationId, app.id) })).toHaveLength(2);
    const audit = await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, app.id) });
    expect(audit[0]).toMatchObject({ action: "application.created", actorId: null, metadata: { systemActor: "career_site" } });
    const [email] = await db.query.emails.findMany({ where: eq(s.emails.candidateId, cand!.id) });
    expect(email.subject).toMatch(/^Nous avons bien reçu/);
  });

  it("a knockout answer archives the application with the reason and one more stage event", async () => {
    const w = await world();
    await w.apply({ answers: { [w.auth.id]: "no" } });
    const [app] = await appsFor(w.job.id);
    expect(app.status).toBe("archived");
    const reason = await db.query.archiveReasons.findFirst({ where: eq(s.archiveReasons.id, app.archiveReasonId!) });
    expect(reason?.name).toBe("Knockout question");
    const events = await db.query.applicationStageEvents.findMany({ where: eq(s.applicationStageEvents.applicationId, app.id) });
    expect(events.map((e) => e.status).sort()).toEqual(["active", "archived"]);
    const [answer] = await db.query.applicationAnswers.findMany({ where: and(eq(s.applicationAnswers.applicationId, app.id), eq(s.applicationAnswers.questionId, w.auth.id)) });
    expect(answer.knockedOut).toBe(true);
  });

  it("re-applying looks the same but creates nothing; a known email reuses the candidate without overwriting", async () => {
    const w = await world();
    await w.apply({ phone: "416-555-0100" });
    expect(await w.apply({ firstName: "Someone", lastName: "Else" })).toEqual({ ok: true });
    expect(await appsFor(w.job.id)).toHaveLength(1);
    const other = await makeJob({ recruiterId: w.rec.id });
    await db.update(s.jobs).set({ status: "open", publishedOnCareerSite: true }).where(eq(s.jobs.id, other.job.id));
    await w.apply({ jobId: other.job.id, firstName: "Changed", phone: "999", answers: {} });
    const cands = await db.query.candidates.findMany();
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ firstName: "Ada", phone: "416-555-0100" });
  });

  it("validates required answers, choices, resumes, and that the job is public", async () => {
    const w = await world();
    expect(await w.apply({ answers: { [w.heard.id]: "linkedin" } })).toMatchObject({ ok: false, error: "answers", field: w.auth.id });
    expect(await w.apply({ answers: { [w.auth.id]: "yes", [w.heard.id]: "made-up" } })).toMatchObject({ ok: false, error: "answers" });
    expect(await w.apply({}, { name: "cv.pdf", bytes: ZIP })).toMatchObject({ ok: false, error: "resume" }); // bytes, not name
    expect(await w.apply({}, { name: "cv.exe", bytes: PDF })).toMatchObject({ ok: false, error: "resume" });
    expect(() => applySchema.parse({ jobId: w.job.id, locale: "en", firstName: "a", lastName: "b", email: "a@b.co", answers: {}, consentProcessing: false, consentTalentPool: false })).toThrow(/consent_required/);
    await db.update(s.jobs).set({ confidential: true }).where(eq(s.jobs.id, w.job.id));
    expect(await w.apply()).toEqual({ ok: false, error: "job_closed" });
    expect(await appsFor(w.job.id)).toHaveLength(0);
  });

  it("resumes follow the candidate's visibility; anonymizing wipes answers and the file", async () => {
    const w = await world();
    await w.apply({}, { name: "cv.pdf", bytes: PDF });
    const cand = (await db.query.candidates.findMany())[0];
    expect((await downloadFile(w.rec, cand.resumeFileId!)).bytes.equals(PDF)).toBe(true);
    const outsider = userActor(await makeUser("hiring_manager"));
    await expect(downloadFile(outsider, cand.resumeFileId!)).rejects.toThrow(/not found/);

    const admin = userActor(await makeUser("admin"));
    await privacy.anonymizeCandidate(admin, cand.id, { reason: "deletion_request" });
    const answers = await db.query.applicationAnswers.findMany();
    expect(answers.every((a) => a.value === null)).toBe(true);
    await expect(downloadFile(w.rec, cand.resumeFileId!)).rejects.toThrow(/not found/);
  });
});

describe("application form questions", () => {
  beforeEach(resetDb);

  it("enforces knockout rules and recruiting permission on visible jobs", async () => {
    const rec = userActor(await makeUser("recruiter"));
    const hm = userActor(await makeUser("hiring_manager"));
    const { job } = await makeJob({ recruiterId: rec.id, hiringManagerId: hm.id });
    const base = { jobId: job.id, labelEn: "Question?", labelFr: "Question ?" };
    expect(() => forms.questionSchema.parse({ ...base, kind: "short_text", passAnswers: ["x"], required: true })).toThrow(/yes\/no and choice/);
    expect(() => forms.questionSchema.parse({ ...base, kind: "yes_no", passAnswers: ["yes"], required: false })).toThrow(/must be required/);
    expect(() => forms.questionSchema.parse({ ...base, kind: "single_select", options: [{ value: "a", en: "A", fr: "A" }] })).toThrow(/two choices/);
    await expect(forms.addQuestion(hm, forms.questionSchema.parse({ ...base, kind: "short_text" }))).rejects.toThrow(/permission/);
    const outsider = userActor(await makeUser("recruiter"));
    const secret = await makeJob({ confidential: true, recruiterId: rec.id });
    await expect(forms.addQuestion(outsider, forms.questionSchema.parse({ ...base, jobId: secret.job.id, kind: "short_text" }))).rejects.toThrow(/not found/);

    const a = await forms.addQuestion(rec, forms.questionSchema.parse({ ...base, kind: "short_text" }));
    const b = await forms.addQuestion(rec, forms.questionSchema.parse({ ...base, kind: "long_text" }));
    await forms.moveQuestion(rec, b.id, "up");
    expect((await forms.listQuestions(rec, job.id)).map((q) => q.id)).toEqual([b.id, a.id]);
    await forms.setQuestionActive(rec, a.id, false);
    expect((await forms.publicQuestions(job.id)).map((q) => q.id)).toEqual([b.id]);
    expect(JSON.stringify(await forms.publicQuestions(job.id))).not.toContain("passAnswers");
  });
});
