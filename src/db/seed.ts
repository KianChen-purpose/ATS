/**
 * Demo seed for PATS. Deterministic (fixed faker seed) so demos look the same every time.
 * Run with: npm run db:seed   (wipes and re-creates all data)
 */
import "dotenv/config";
import { faker } from "@faker-js/faker";
import { sql } from "drizzle-orm";
import { db } from "./index";
import * as s from "./schema";

faker.seed(20261001);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const daysAgo = (d: number) => new Date(now - d * DAY);
const pick = <T>(arr: readonly T[]) => arr[Math.floor(faker.number.float() * arr.length)];

async function reset() {
  const tables = [
    "report_dashboard_items",
    "report_dashboard_shares",
    "report_dashboards",
    "saved_report_shares",
    "saved_reports",
    "talent_pool_members",
    "talent_pools",
    "referrals",
    "application_answers",
    "application_questions",
    "offer_letter_templates",
    "files",
    "approval_steps",
    "approval_requests",
    "approval_chain_steps",
    "approval_chains",
    "data_subject_requests",
    "consent_records",
    "retention_policies",
    "job_translations",
    "integration_events",
    "scheduling_links",
    "audit_logs",
    "emails",
    "email_templates",
    "offers",
    "scorecards",
    "interview_interviewers",
    "interviews",
    "feedback_forms",
    "activities",
    "application_stage_events",
    "applications",
    "archive_reasons",
    "sources",
    "candidates",
    "openings",
    "job_hiring_team",
    "job_stages",
    "jobs",
    "users",
    "locations",
    "departments",
    "brands",
  ];
  await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} CASCADE`));
  // Local FileStore holds only demo files; start it fresh too.
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  await rm(path.resolve(process.env.FILE_STORE_DIR ?? ".storage"), { recursive: true, force: true });
}

const BRANDS = [
  { name: "Purpose Investments", slug: "purpose-investments", tagline: "Investing in a better future" },
  { name: "Purpose Advisor Solutions", slug: "purpose-advisor-solutions", tagline: "Built for independent advisors" },
  { name: "Steadyhand", slug: "steadyhand", tagline: "Investing made simple" },
  { name: "Harness Investment Management", slug: "harness", tagline: "Disciplined, data-driven investing" },
  { name: "Driven", slug: "driven", tagline: "Wealth for the next generation" },
  { name: "Foundation Wealth Partners", slug: "foundation-wealth", tagline: "Partners in your wealth" },
];

const DEPARTMENTS = [
  "Engineering",
  "Product",
  "Investments",
  "Distribution & Sales",
  "Marketing",
  "Finance",
  "Compliance & Legal",
  "People & Culture",
  "Operations",
  "Client Experience",
];

const LOCATIONS = [
  { name: "Toronto, ON", city: "Toronto", region: "ON" },
  { name: "Vancouver, BC", city: "Vancouver", region: "BC" },
  { name: "Montréal, QC", city: "Montréal", region: "QC" },
  { name: "Calgary, AB", city: "Calgary", region: "AB" },
  { name: "Remote (Canada)", city: null, region: null },
];

const USERS: { name: string; title: string; role: (typeof s.userRole.enumValues)[number] }[] = [
  { name: "Kian Chen", title: "Head of Talent Systems", role: "admin" },
  { name: "Maya Thompson", title: "Senior Technical Recruiter", role: "recruiter" },
  { name: "Daniel Okafor", title: "Talent Acquisition Partner", role: "recruiter" },
  { name: "Sophie Tremblay", title: "Talent Acquisition Partner", role: "recruiter" },
  { name: "Priya Raman", title: "Recruiting Coordinator", role: "coordinator" },
  { name: "Lucas Martin", title: "Recruiting Coordinator", role: "coordinator" },
  { name: "Elena Rossi", title: "VP, Engineering", role: "hiring_manager" },
  { name: "Marcus Lee", title: "Director, Product", role: "hiring_manager" },
  { name: "Aisha Khan", title: "Portfolio Manager", role: "hiring_manager" },
  { name: "Ben Fischer", title: "VP, Distribution", role: "hiring_manager" },
  { name: "Chloé Gagnon", title: "Director, Marketing", role: "hiring_manager" },
  { name: "Ravi Patel", title: "Controller", role: "hiring_manager" },
  { name: "Grace Kim", title: "Chief Compliance Officer", role: "hiring_manager" },
  { name: "Tom Walsh", title: "Staff Software Engineer", role: "interviewer" },
  { name: "Nina Alvarez", title: "Senior Software Engineer", role: "interviewer" },
  { name: "Owen Brooks", title: "Product Designer", role: "interviewer" },
  { name: "Fatima Noor", title: "Senior Analyst", role: "interviewer" },
  { name: "Jake Morrison", title: "Regional Sales Director", role: "interviewer" },
  { name: "Hannah Wu", title: "Engineering Manager", role: "interviewer" },
  { name: "Samuel Osei", title: "Data Engineer", role: "interviewer" },
  { name: "Olivia Bennett", title: "Chief People Officer", role: "executive" },
  { name: "James Carter", title: "CFO", role: "executive" },
];


const STAGE_TEMPLATE: { name: string; type: (typeof s.stageType.enumValues)[number] }[] = [
  { name: "Lead", type: "lead" },
  { name: "Application Review", type: "review" },
  { name: "Recruiter Screen", type: "screen" },
  { name: "Hiring Manager Interview", type: "interview" },
  { name: "Skills Interview", type: "interview" },
  { name: "Final Interviews", type: "interview" },
  { name: "Offer", type: "offer" },
  { name: "Hired", type: "hired" },
];

const JOBS: {
  title: string;
  brand: string;
  dept: string;
  hm: string;
  recruiter: string;
  comp: [number, number];
  status?: (typeof s.jobStatus.enumValues)[number];
  confidential?: boolean;
  openings?: number;
}[] = [
  { title: "Senior Full-Stack Engineer", brand: "purpose-investments", dept: "Engineering", hm: "Elena Rossi", recruiter: "Maya Thompson", comp: [140000, 175000], openings: 2 },
  { title: "Staff Platform Engineer", brand: "purpose-advisor-solutions", dept: "Engineering", hm: "Elena Rossi", recruiter: "Maya Thompson", comp: [175000, 215000] },
  { title: "Data Engineer", brand: "harness", dept: "Engineering", hm: "Elena Rossi", recruiter: "Maya Thompson", comp: [120000, 150000] },
  { title: "Senior Product Manager", brand: "purpose-advisor-solutions", dept: "Product", hm: "Marcus Lee", recruiter: "Daniel Okafor", comp: [145000, 180000] },
  { title: "Product Designer", brand: "steadyhand", dept: "Product", hm: "Marcus Lee", recruiter: "Daniel Okafor", comp: [105000, 135000] },
  { title: "Associate Portfolio Manager", brand: "purpose-investments", dept: "Investments", hm: "Aisha Khan", recruiter: "Sophie Tremblay", comp: [110000, 140000] },
  { title: "Quantitative Analyst", brand: "harness", dept: "Investments", hm: "Aisha Khan", recruiter: "Sophie Tremblay", comp: [115000, 145000] },
  { title: "Regional Sales Manager – Western Canada", brand: "purpose-investments", dept: "Distribution & Sales", hm: "Ben Fischer", recruiter: "Daniel Okafor", comp: [95000, 125000], openings: 2 },
  { title: "Wealth Advisor", brand: "driven", dept: "Distribution & Sales", hm: "Ben Fischer", recruiter: "Sophie Tremblay", comp: [80000, 110000], openings: 3 },
  { title: "Marketing Manager, Brand", brand: "steadyhand", dept: "Marketing", hm: "Chloé Gagnon", recruiter: "Sophie Tremblay", comp: [90000, 115000] },
  { title: "Senior Financial Analyst", brand: "purpose-investments", dept: "Finance", hm: "Ravi Patel", recruiter: "Daniel Okafor", comp: [95000, 120000] },
  { title: "Compliance Officer", brand: "foundation-wealth", dept: "Compliance & Legal", hm: "Grace Kim", recruiter: "Sophie Tremblay", comp: [100000, 130000] },
  { title: "Client Experience Specialist (Bilingual)", brand: "steadyhand", dept: "Client Experience", hm: "Chloé Gagnon", recruiter: "Sophie Tremblay", comp: [55000, 68000], openings: 2 },
  { title: "Chief Technology Officer", brand: "purpose-advisor-solutions", dept: "Engineering", hm: "Olivia Bennett", recruiter: "Maya Thompson", comp: [280000, 340000], confidential: true },
  { title: "Operations Analyst", brand: "foundation-wealth", dept: "Operations", hm: "Ravi Patel", recruiter: "Daniel Okafor", comp: [70000, 88000], status: "on_hold" },
  { title: "Junior Developer (2027 Grad)", brand: "purpose-investments", dept: "Engineering", hm: "Elena Rossi", recruiter: "Maya Thompson", comp: [75000, 85000], status: "draft" },
];

const SOURCES: { name: string; category: (typeof s.sourceCategory.enumValues)[number] }[] = [
  { name: "Career Site", category: "inbound" },
  { name: "LinkedIn (Applied)", category: "inbound" },
  { name: "Indeed", category: "inbound" },
  { name: "Employee Referral", category: "referral" },
  { name: "LinkedIn Recruiter", category: "sourced" },
  { name: "Agency – Hunt Partners", category: "agency" },
  { name: "Internal Transfer", category: "internal" },
];
const SOURCE_WEIGHTS = [30, 22, 10, 14, 16, 5, 3];

const ARCHIVE_REASONS: { name: string; category: (typeof s.archiveCategory.enumValues)[number] }[] = [
  { name: "Not enough relevant experience", category: "rejected" },
  { name: "Skills mismatch", category: "rejected" },
  { name: "Compensation expectations", category: "rejected" },
  { name: "Location / work authorization", category: "rejected" },
  { name: "Stronger candidate selected", category: "rejected" },
  { name: "Candidate withdrew", category: "withdrew" },
  { name: "Accepted another offer", category: "withdrew" },
  { name: "Unresponsive", category: "other" },
  { name: "Knockout question", category: "rejected" },
];

const SKILLS_BY_DEPT: Record<string, string[]> = {
  Engineering: ["TypeScript", "React", "Node.js", ".NET", "Azure", "PostgreSQL", "Kubernetes", "Python", "AWS", "GraphQL"],
  Product: ["Roadmapping", "Discovery", "Figma", "Analytics", "B2B SaaS", "Fintech"],
  Investments: ["CFA", "Portfolio Construction", "Fixed Income", "Equities", "Python", "Bloomberg", "Risk"],
  "Distribution & Sales": ["Advisor Relationships", "CRM", "ETF Sales", "Wealth Management", "CIRO Licensed"],
  Marketing: ["Brand", "Content", "Paid Social", "SEO", "Bilingual EN/FR"],
  Finance: ["CPA", "FP&A", "Excel", "IFRS", "Power BI"],
  "Compliance & Legal": ["CIRO", "OSC", "AML", "KYC", "Policy"],
  "Client Experience": ["Bilingual EN/FR", "Zendesk", "Client Service", "Onboarding"],
  Operations: ["Process Improvement", "SQL", "Trade Ops", "Reconciliation"],
  "People & Culture": ["HRIS", "Talent", "Workday"],
};

const COMPANIES = ["RBC", "TD", "Scotiabank", "BMO", "CIBC", "Wealthsimple", "Questrade", "Shopify", "Manulife", "Sun Life", "CI Financial", "Mackenzie", "Fidelity Canada", "Vanguard", "BlackRock", "Ada", "Koho", "Nest Wealth", "Deloitte", "KPMG", "EY", "Accenture"];

function weightedPick<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = faker.number.float() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

async function main() {
  console.log("Resetting database…");
  await reset();

  const brands = await db.insert(s.brands).values(BRANDS.map((b) => ({ ...b, websiteUrl: `https://www.${b.slug}.com` }))).returning();
  const brandBySlug = Object.fromEntries(brands.map((b) => [b.slug, b]));

  const departments = await db.insert(s.departments).values(DEPARTMENTS.map((name) => ({ name }))).returning();
  const deptByName = Object.fromEntries(departments.map((d) => [d.name, d]));

  const locations = await db.insert(s.locations).values(LOCATIONS).returning();

  const users = await db
    .insert(s.users)
    .values(
      USERS.map((u) => ({
        ...u,
        email: `${u.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, ".")}@purpose.demo`,
      })),
    )
    .returning();
  const userByName = Object.fromEntries(users.map((u) => [u.name, u]));
  const interviewers = users.filter((u) => ["interviewer", "hiring_manager"].includes(u.role));
  const coordinators = users.filter((u) => u.role === "coordinator");

  const sources = await db.insert(s.sources).values(SOURCES).returning();
  const archiveReasons = await db.insert(s.archiveReasons).values(ARCHIVE_REASONS).returning();

  const [defaultForm] = await db
    .insert(s.feedbackForms)
    .values([
      {
        name: "Standard Interview Scorecard",
        attributes: [
          { key: "role_skills", label: "Role-specific skills", description: "Depth of knowledge and hands-on experience for this role." },
          { key: "problem_solving", label: "Problem solving", description: "Structures ambiguous problems, weighs trade-offs, reaches sound conclusions." },
          { key: "communication", label: "Communication", description: "Clear, concise, adapts to the audience, listens well." },
          { key: "values", label: "Purpose values alignment", description: "Participation, ownership, client-first thinking." },
        ],
      },
    ])
    .returning();

  await db.insert(s.retentionPolicies).values(DEMO_RETENTION);
  await db.insert(s.emailTemplates).values([
    ...FR_TEMPLATES,
    {
      templateKey: "screen_invite",
      name: "Recruiter screen invite",
      subject: "{{brand.name}} – let's chat about the {{job.title}} role",
      body: "Hi {{candidate.firstName}},\n\nThanks for your interest in the {{job.title}} role at {{brand.name}}. I'd love to set up a 30-minute call to learn more about you.\n\nBest,\n{{sender.name}}",
    },
    {
      templateKey: "rejection_review",
      name: "Rejection – after application review",
      subject: "Your application to {{brand.name}}",
      body: "Hi {{candidate.firstName}},\n\nThank you for applying for the {{job.title}} role. After careful review we've decided to move forward with other candidates. We'll keep your profile on file for future roles.\n\nAll the best,\n{{sender.name}}",
    },
    {
      templateKey: "outreach_sourced",
      name: "Outreach – sourced candidate",
      subject: "{{job.title}} at {{brand.name}}",
      body: "Hi {{candidate.firstName}},\n\nYour background caught my eye. We're hiring a {{job.title}} at {{brand.name}} and I think you'd be a great fit. Open to a quick chat?\n\n{{sender.name}}",
    },
  ]);

  console.log("Creating approval chains…");
  const chain = async (name: string, subject: "job" | "offer", minAmount: number | null, steps: { approverType: "user" | "hiring_manager"; approverId?: string }[]) => {
    const [row] = await db.insert(s.approvalChains).values({ name, subject, minAmount }).returning();
    await db.insert(s.approvalChainSteps).values(steps.map((st, position) => ({ chainId: row.id, position, approverType: st.approverType, approverId: st.approverId ?? null })));
    return {
      id: row.id,
      approvers: (hiringManagerId: string) =>
        steps.map((st) => (st.approverType === "hiring_manager" ? hiringManagerId : st.approverId!)).filter((id, i, all) => id !== all[i - 1]),
    };
  };
  const cfo = userByName["James Carter"].id;
  const cpo = userByName["Olivia Bennett"].id;
  await chain("New jobs – all brands", "job", null, [{ approverType: "hiring_manager" }, { approverType: "user", approverId: cpo }]);
  const offerChain = await chain("Offers – all brands", "offer", null, [{ approverType: "hiring_manager" }, { approverType: "user", approverId: cfo }]);
  const seniorOfferChain = await chain("Offers $200k+ – all brands", "offer", 200_000, [
    { approverType: "hiring_manager" },
    { approverType: "user", approverId: cpo },
    { approverType: "user", approverId: cfo },
  ]);

  console.log("Creating offer letter templates…");
  {
    const { createHash, randomUUID } = await import("node:crypto");
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");
    const { buildDefaultLetterTemplate } = await import("./letter-templates");
    const root = path.resolve(process.env.FILE_STORE_DIR ?? ".storage");
    for (const [locale, name] of [["en", "Standard offer letter"], ["fr-CA", "Lettre d'offre standard"]] as const) {
      const bytes = await buildDefaultLetterTemplate(locale);
      const id = randomUUID();
      const storageKey = `offer_letter_template/${id.slice(0, 2)}/${id}`;
      await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
      await writeFile(path.join(root, storageKey), bytes);
      await db.insert(s.files).values({
        id,
        kind: "offer_letter_template",
        storageKey,
        fileName: `${name}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
      await db.insert(s.offerLetterTemplates).values({ name, locale, fileId: id });
    }
  }

  console.log("Creating jobs…");
  let openingSeq = 1000;
  const jobRows: { job: typeof s.jobs.$inferSelect; stages: (typeof s.jobStages.$inferSelect)[]; dept: string; team: typeof users; openings: number }[] = [];
  for (const j of JOBS) {
    const status = j.status ?? "open";
    const openedDaysAgo = faker.number.int({ min: 20, max: 140 });
    const [job] = await db
      .insert(s.jobs)
      .values({
        title: j.title,
        brandId: brandBySlug[j.brand].id,
        departmentId: deptByName[j.dept].id,
        locationId: pick(locations).id,
        status,
        confidential: j.confidential ?? false,
        compMin: j.comp[0],
        compMax: j.comp[1],
        workplaceType: pick(["hybrid", "hybrid", "onsite", "remote"] as const),
        description: jobDescription(j.title, BRANDS.find((b) => b.slug === j.brand)!.name),
        publishedOnCareerSite: status === "open" && !j.confidential,
        hiringManagerId: userByName[j.hm].id,
        recruiterId: userByName[j.recruiter].id,
        coordinatorId: pick(coordinators).id,
        createdAt: daysAgo(openedDaysAgo + 5),
        openedAt: status === "draft" ? null : daysAgo(openedDaysAgo),
      })
      .returning();
    const stages = await db
      .insert(s.jobStages)
      .values(STAGE_TEMPLATE.map((st, i) => ({ ...st, jobId: job.id, position: i })))
      .returning();
    await db.insert(s.openings).values(
      Array.from({ length: j.openings ?? 1 }, () => ({
        jobId: job.id,
        code: `REQ-${openingSeq++}`,
        createdAt: daysAgo(openedDaysAgo),
        reason: pick(["new_headcount", "new_headcount", "backfill"] as const),
        targetStartDate: new Date(now + faker.number.int({ min: 20, max: 120 }) * DAY).toISOString().slice(0, 10),
      })),
    );
    const team = faker.helpers.arrayElements(interviewers.filter((u) => u.id !== job.hiringManagerId), 3);
    await db.insert(s.jobHiringTeam).values(team.map((u) => ({ jobId: job.id, userId: u.id })));
    jobRows.push({ job, stages, dept: j.dept, team, openings: j.openings ?? 1 });
    if (job.publishedOnCareerSite) {
      await db.insert(s.applicationQuestions).values([
        {
          jobId: job.id,
          position: 0,
          kind: "yes_no",
          labelEn: "Are you legally entitled to work in Canada?",
          labelFr: "Êtes-vous légalement autorisé(e) à travailler au Canada?",
          required: true,
          passAnswers: ["yes"],
        },
        {
          jobId: job.id,
          position: 1,
          kind: "single_select",
          labelEn: "How did you hear about this role?",
          labelFr: "Comment avez-vous entendu parler de ce poste?",
          options: [
            { value: "linkedin", en: "LinkedIn", fr: "LinkedIn" },
            { value: "referral", en: "Someone who works here", fr: "Une personne qui travaille ici" },
            { value: "website", en: "Our website", fr: "Notre site Web" },
            { value: "other", en: "Somewhere else", fr: "Ailleurs" },
          ],
        },
      ]);
      await db.insert(s.jobTranslations).values({
        jobId: job.id,
        locale: "fr-CA",
        title: job.title,
        description: jobDescriptionFr(job.title, BRANDS.find((b) => b.slug === j.brand)!.name),
      });
    }
  }

  console.log("Creating candidates & applications…");
  const activeJobs = jobRows.filter((r) => r.job.status !== "draft");
  // Funnel shape: how far applications progress. Index = furthest stage position reached.
  const reachWeights = [6, 34, 22, 15, 9, 7, 4, 3];
  // Older applications have had time to finish, so more of them reached offer and hire.
  const hiresByJob = new Map<string, number>();
  const matureReachWeights = [4, 24, 20, 16, 11, 9, 6, 10];

  for (let i = 0; i < 320; i++) {
    const { job, stages, dept, team, openings } = pick(activeJobs);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const skills = faker.helpers.arrayElements(SKILLS_BY_DEPT[dept] ?? ["Communication"], { min: 2, max: 4 });
    const company = pick(COMPANIES);
    const title = jobTitleVariant(job.title);
    const source = weightedPick(sources, SOURCE_WEIGHTS);
    const openedAgo = Math.floor((now - (job.openedAt ?? job.createdAt).getTime()) / DAY);
    const appliedAgo = faker.number.int({ min: 1, max: Math.max(2, openedAgo) });

    const candLocation = pick(LOCATIONS).name;
    const [cand] = await db
      .insert(s.candidates)
      .values({
        firstName,
        lastName,
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        phone: faker.phone.number({ style: "national" }),
        location: candLocation,
        currentTitle: title,
        currentCompany: company,
        linkedinUrl: `https://www.linkedin.com/in/${firstName}-${lastName}-${faker.string.alphanumeric(5)}`.toLowerCase(),
        tags: skills,
        resumeText: `${firstName} ${lastName}\n${title} at ${company}\n\nSkills: ${skills.join(", ")}\n\n${faker.lorem.paragraphs(2)}`,
        resumeFileName: `${firstName}_${lastName}_Resume.pdf`,
        ownerId: job.recruiterId,
        preferredLocale: candLocation === "Montréal, QC" ? "fr-CA" : "en",
        createdAt: daysAgo(appliedAgo),
        updatedAt: daysAgo(Math.max(0, appliedAgo - 3)),
      })
      .returning();

    // Applying records consent to process the application. Sourced prospects haven't consented to anything.
    if (source.category !== "sourced") {
      await db.insert(s.consentRecords).values({
        candidateId: cand.id,
        purpose: "application_processing",
        granted: true,
        policyVersion: "2026-10",
        locale: cand.preferredLocale,
        source: source.category === "referral" ? "referral" : "career_site",
        createdAt: daysAgo(appliedAgo),
      });
    }

    // Sourced candidates start at Lead; inbound at Application Review.
    const startPos = source.category === "sourced" ? 0 : 1;
    let reach = Math.max(startPos, weightedPick([0, 1, 2, 3, 4, 5, 6, 7], appliedAgo > 40 ? matureReachWeights : reachWeights));
    if (job.status === "on_hold") reach = Math.min(reach, 3);
    // A job can't hire more people than it has openings.
    if (reach === 7 && (hiresByJob.get(job.id) ?? 0) >= openings) reach = 5;
    if (reach === 7) hiresByJob.set(job.id, (hiresByJob.get(job.id) ?? 0) + 1);

    // Walk through stages, spreading time across the elapsed window.
    const path = stages.filter((st) => st.position >= startPos && st.position <= reach);
    const isHired = reach === 7;
    // Applications that stopped before the end: most are archived, recent ones are still active.
    const archived = !isHired && (appliedAgo > 12 ? faker.number.float() < 0.62 : faker.number.float() < 0.15);
    // Finished applications (hired or archived) took a few weeks and ended in the past; active
    // ones are spread across their whole elapsed time, so they're still in motion today.
    const span = isHired || archived ? Math.min(appliedAgo, faker.number.int({ min: 10, max: 50 })) : appliedAgo;
    const stepDays = span / (path.length + 1);
    const events: (typeof s.applicationStageEvents.$inferInsert)[] = [];
    const recruiter = job.recruiterId!;
    let t = appliedAgo;
    const currentStage = path[path.length - 1];

    const [app] = await db
      .insert(s.applications)
      .values({
        candidateId: cand.id,
        jobId: job.id,
        stageId: currentStage.id,
        status: isHired ? "hired" : archived ? "archived" : "active",
        sourceId: source.id,
        creditedToId: recruiter,
        referrerId: source.category === "referral" ? pick(users).id : null,
        appliedAt: daysAgo(appliedAgo),
        stageEnteredAt: daysAgo(Math.max(0, appliedAgo - stepDays * (path.length - 1))),
        archiveReasonId: archived ? pick(currentStage.position <= 2 ? archiveReasons.slice(0, 4) : archiveReasons).id : null,
        archivedAt: archived ? daysAgo(Math.max(0, appliedAgo - stepDays * path.length)) : null,
        hiredAt: isHired ? daysAgo(Math.max(0, appliedAgo - stepDays * path.length)) : null,
      })
      .returning();

    const acts: (typeof s.activities.$inferInsert)[] = [
      {
        candidateId: cand.id,
        applicationId: app.id,
        type: "application_created",
        actorId: source.category === "sourced" ? recruiter : null,
        body: source.category === "sourced" ? `Sourced from ${source.name}` : `Applied via ${source.name}`,
        createdAt: daysAgo(appliedAgo),
      },
    ];

    path.forEach((st, idx) => {
      events.push({
        applicationId: app.id,
        fromStageId: idx === 0 ? null : path[idx - 1].id,
        toStageId: st.id,
        status: "active",
        movedById: idx === 0 ? null : recruiter,
        createdAt: daysAgo(t),
      });
      if (idx > 0) {
        acts.push({
          candidateId: cand.id,
          applicationId: app.id,
          type: "stage_change",
          actorId: recruiter,
          body: `Moved from ${path[idx - 1].name} to ${st.name}`,
          metadata: { fromStage: path[idx - 1].name, toStage: st.name },
          createdAt: daysAgo(t),
        });
      }
      t -= stepDays;
    });

    if (archived || isHired) {
      events.push({
        applicationId: app.id,
        fromStageId: currentStage.id,
        toStageId: currentStage.id,
        status: isHired ? "hired" : "archived",
        movedById: recruiter,
        createdAt: app.archivedAt ?? app.hiredAt!,
      });
      acts.push({
        candidateId: cand.id,
        applicationId: app.id,
        type: isHired ? "hired" : "archived",
        actorId: recruiter,
        body: isHired ? "Marked as hired 🎉" : `Archived: ${archiveReasons.find((r) => r.id === app.archiveReasonId)?.name}`,
        createdAt: app.archivedAt ?? app.hiredAt!,
      });
    }

    if (faker.number.float() < 0.45) {
      acts.push({
        candidateId: cand.id,
        applicationId: app.id,
        type: "note",
        actorId: pick([recruiter, job.hiringManagerId!]),
        body: pick([
          "Strong background, especially their recent work at " + company + ".",
          "Comp expectations may be at the top of the band — flag for HM.",
          "Great energy on the call. Interested in hybrid in Toronto.",
          "Needs sponsorship? Confirm work authorization.",
          "Referred by a current employee — prioritize.",
          "Prefers to interview after 2pm ET.",
        ]),
        createdAt: daysAgo(Math.max(0, appliedAgo - 2)),
      });
    }

    // Interviews + scorecards for interview-type stages reached.
    for (const st of path.filter((p) => p.type === "screen" || p.type === "interview")) {
      const enteredEvent = events.find((e) => e.toStageId === st.id)!;
      const enteredAgo = (now - (enteredEvent.createdAt as Date).getTime()) / DAY;
      const isCurrentAndActive = st.id === currentStage.id && app.status === "active";
      // Current active stage: interview may be upcoming.
      const startAgo = isCurrentAndActive ? -faker.number.float({ min: 0.2, max: 6 }) : Math.max(0.5, enteredAgo - 2);
      const start = new Date(now - startAgo * DAY);
      // Business hours in Toronto (13:00–20:30 UTC), weekdays only.
      start.setUTCHours(faker.number.int({ min: 13, max: 20 }), pick([0, 30]), 0, 0);
      while (start.getUTCDay() === 0 || start.getUTCDay() === 6) start.setTime(start.getTime() + (startAgo < 0 ? 1 : -1) * DAY);
      const panel =
        st.type === "screen"
          ? [users.find((u) => u.id === recruiter)!]
          : // Panels come from the job's hiring team (plus the HM), so every interviewer can see the job.
            faker.helpers.arrayElements([...team, users.find((u) => u.id === job.hiringManagerId)!], st.name === "Final Interviews" ? 3 : 1);
      const upcoming = start.getTime() > now;
      const [iv] = await db
        .insert(s.interviews)
        .values({
          applicationId: app.id,
          stageId: st.id,
          feedbackFormId: defaultForm.id,
          title: `${st.name} – ${firstName} ${lastName}`,
          startAt: start,
          endAt: new Date(start.getTime() + (st.type === "screen" ? 30 : 60) * 60 * 1000),
          location: "Microsoft Teams",
          meetingUrl: `https://teams.microsoft.com/l/meetup-join/demo-${faker.string.alphanumeric(10)}`,
          externalEventId: `AAMkAG${faker.string.alphanumeric(16)}`,
          status: upcoming ? "scheduled" : "completed",
          createdById: pick(coordinators).id,
          createdAt: new Date(Math.min(now - 3_600_000, start.getTime() - 3 * DAY)),
        })
        .returning();
      await db.insert(s.interviewInterviewers).values(panel.map((u) => ({ interviewId: iv.id, userId: u.id })));
      acts.push({
        candidateId: cand.id,
        applicationId: app.id,
        type: "interview_scheduled",
        actorId: iv.createdById,
        body: `Scheduled ${st.name} with ${panel.map((p) => p.name).join(", ")}`,
        metadata: { interviewId: iv.id },
        createdAt: iv.createdAt,
      });
      if (!upcoming) {
        // Advanced past this stage → mostly positive feedback; final stage reached and archived → mixed.
        const advanced = st.position < currentStage.position || isHired;
        for (const author of panel) {
          if (!advanced && faker.number.float() < 0.25) continue; // some feedback still outstanding
          const overall = advanced
            ? weightedPick(["strong_yes", "yes", "no"] as const as unknown as ("strong_yes" | "yes" | "no")[], [35, 55, 10])
            : weightedPick(["yes", "no", "strong_no"] as const as unknown as ("yes" | "no" | "strong_no")[], [30, 50, 20]);
          const base = { strong_yes: 4, yes: 3, no: 2, strong_no: 1 }[overall];
          const submittedAt = new Date(start.getTime() + faker.number.float({ min: 0.05, max: 1.8 }) * DAY);
          await db.insert(s.scorecards).values({
            applicationId: app.id,
            interviewId: iv.id,
            authorId: author.id,
            overall,
            ratings: Object.fromEntries(
              defaultForm.attributes.map((a) => [a.key, Math.min(4, Math.max(1, base + faker.number.int({ min: -1, max: 1 })))]),
            ),
            notes: pick([
              "Clear communicator, structured thinking. Would like to see more depth on scale.",
              "Excellent domain knowledge. Asked thoughtful questions about our ETF lineup.",
              "Solid fundamentals; a bit light on leadership examples.",
              "Very strong — would raise the bar for the team.",
              "Some gaps in hands-on experience with our stack.",
            ]),
            submittedAt,
          });
          acts.push({
            candidateId: cand.id,
            applicationId: app.id,
            type: "feedback_submitted",
            actorId: author.id,
            body: `Submitted feedback for ${st.name}`,
            metadata: { overall, stage: st.name },
            createdAt: submittedAt,
          });
        }
      }
    }

    // Offers for candidates who reached Offer.
    if (reach >= 6) {
      const offerStatus = isHired ? "accepted" : app.status === "archived" ? "declined" : pick(["pending_approval", "approved", "sent"] as const);
      const offerAt = events.find((e) => e.toStageId === stages[6].id)!.createdAt as Date;
      const [offer] = await db
        .insert(s.offers)
        .values({
          applicationId: app.id,
          status: offerStatus,
          baseSalary: Math.round(faker.number.int({ min: Math.round(job.compMin! * 0.95), max: Math.round(job.compMax! * 1.06) }) / 1000) * 1000,
          bonusPercent: pick([10, 15, 20]),
          startDate: new Date(now + faker.number.int({ min: 14, max: 60 }) * DAY).toISOString().slice(0, 10),
          createdById: recruiter,
          createdAt: offerAt,
          sentAt: ["sent", "accepted", "declined"].includes(offerStatus) ? new Date(offerAt.getTime() + 2 * DAY) : null,
          decidedAt: ["accepted", "declined"].includes(offerStatus) ? new Date(offerAt.getTime() + faker.number.int({ min: 3, max: 9 }) * DAY) : null,
          declineReason: offerStatus === "declined" ? pick(["Accepted another offer", "Compensation", "Compensation", "Counter-offer from current employer", "Role scope", "Relocation"]) : null,
        })
        .returning();
      const chain = offer.baseSalary >= 200_000 ? seniorOfferChain : offerChain;
      const approvers = chain.approvers(job.hiringManagerId!);
      const pending = offerStatus === "pending_approval";
      const [request] = await db
        .insert(s.approvalRequests)
        .values({
          subject: "offer",
          subjectId: offer.id,
          jobId: job.id,
          chainId: chain.id,
          status: pending ? "pending" : "approved",
          requestedById: recruiter,
          createdAt: offerAt,
          completedAt: pending ? null : new Date(offerAt.getTime() + approvers.length * 0.5 * DAY),
        })
        .returning();
      await db.insert(s.approvalSteps).values(
        approvers.map((approverId, idx) => {
          // Pending offers wait on their last approver.
          const waiting = pending && idx === approvers.length - 1;
          return {
            requestId: request.id,
            position: idx,
            approverId,
            status: waiting ? ("pending" as const) : ("approved" as const),
            decidedAt: waiting ? null : new Date(offerAt.getTime() + (idx + 1) * 0.5 * DAY),
          };
        }),
      );
      acts.push({
        candidateId: cand.id,
        applicationId: app.id,
        type: "offer_created",
        actorId: recruiter,
        body: `Created offer: $${offer.baseSalary.toLocaleString()} base + ${offer.bonusPercent}% bonus`,
        metadata: { offerId: offer.id },
        createdAt: offerAt,
      });
    }

    // A recruiter email for anyone past review.
    if (reach >= 2) {
      const sender = users.find((u) => u.id === recruiter)!;
      const sentAt = daysAgo(Math.max(0, appliedAgo - stepDays));
      await db.insert(s.emails).values({
        candidateId: cand.id,
        applicationId: app.id,
        direction: "outbound",
        fromAddress: sender.email,
        toAddress: cand.email!,
        subject: `Next steps – ${job.title}`,
        body: `Hi ${firstName},\n\nThanks for applying! I'd love to set up a quick call to chat about the ${job.title} role.\n\nBest,\n${sender.name}`,
        sentById: sender.id,
        sentAt,
      });
      acts.push({
        candidateId: cand.id,
        applicationId: app.id,
        type: "email",
        actorId: sender.id,
        body: `Emailed: Next steps – ${job.title}`,
        createdAt: sentAt,
      });
    }

    await db.insert(s.applicationStageEvents).values(events);
    // Nothing in the timeline can be in the future (e.g. "scheduled" activity for an upcoming interview).
    for (const a of acts) {
      const t = (a.createdAt as Date).getTime();
      if (t > now) a.createdAt = new Date(now - faker.number.int({ min: 1, max: 48 }) * 3_600_000);
    }
    await db.insert(s.activities).values(acts);
  }

  // Mark openings filled for hires: the nth hire on a job fills its nth opening, on the hire date.
  await db.execute(sql`
    WITH hires AS (
      SELECT a.job_id, a.hired_at, row_number() OVER (PARTITION BY a.job_id ORDER BY a.hired_at, a.id) AS n
      FROM applications a WHERE a.status = 'hired'
    ), slots AS (
      SELECT o.id, o.job_id, row_number() OVER (PARTITION BY o.job_id ORDER BY o.code) AS n FROM openings o
    )
    UPDATE openings o SET status = 'filled', filled_at = COALESCE(h.hired_at, now())
    FROM slots sl JOIN hires h ON h.job_id = sl.job_id AND h.n = sl.n
    WHERE o.id = sl.id`);

  console.log("Creating talent pools…");
  {
    const recruiter = userByName["Maya Thompson"];
    const [eng, cx] = await db
      .insert(s.talentPools)
      .values([
        { name: "Senior engineers – Toronto", description: "Platform and full-stack, for 2027 hiring", ownerId: recruiter.id },
        { name: "Bilingual client experience", description: "EN/FR client-facing talent", ownerId: userByName["Sophie Tremblay"].id },
      ])
      .returning();
    const prospects = [
      { firstName: "Imani", lastName: "Okoro", currentTitle: "Staff Engineer", currentCompany: "Wealthsimple", pool: eng.id, stage: "interested" as const },
      { firstName: "Mateo", lastName: "Silva", currentTitle: "Senior Backend Engineer", currentCompany: "Shopify", pool: eng.id, stage: "contacted" as const },
      { firstName: "Priya", lastName: "Natarajan", currentTitle: "Engineering Lead", currentCompany: "KOHO", pool: eng.id, stage: "new" as const },
      { firstName: "Liam", lastName: "Chen", currentTitle: "Platform Engineer", currentCompany: "Questrade", pool: eng.id, stage: "not_interested" as const },
      { firstName: "Camille", lastName: "Bouchard", currentTitle: "Conseillère principale", currentCompany: "Desjardins", pool: cx.id, stage: "interested" as const },
      { firstName: "Olivier", lastName: "Roy", currentTitle: "Client Success Manager", currentCompany: "National Bank", pool: cx.id, stage: "new" as const },
    ];
    for (const p of prospects) {
      const [c] = await db
        .insert(s.candidates)
        .values({
          firstName: p.firstName,
          lastName: p.lastName,
          email: `${p.firstName}.${p.lastName}@example.org`.toLowerCase(),
          currentTitle: p.currentTitle,
          currentCompany: p.currentCompany,
          ownerId: recruiter.id,
          preferredLocale: p.pool === cx.id ? "fr-CA" : "en",
        })
        .returning();
      await db.insert(s.talentPoolMembers).values({ poolId: p.pool, candidateId: c.id, stage: p.stage, addedById: recruiter.id });
      await db.insert(s.activities).values({ candidateId: c.id, type: "note", actorId: recruiter.id, body: "Sourced as a prospect", createdAt: daysAgo(10) });
    }
  }

  console.log("Creating saved reports…");
  {
    const owner = userByName["Maya Thompson"];
    const defs = [
      { name: "Applications per month by source type", description: "Where applications come from, month by month.", definition: { dataset: "applications", dateField: "applied_at", groupBy: ["month", "source_category"], metrics: ["count"], filters: [], visualization: "pivot" } },
      { name: "Weekly applications", description: null, definition: { dataset: "applications", dateField: "applied_at", groupBy: ["week"], metrics: ["count", "hired"], filters: [], visualization: "line" } },
      { name: "Hire rate by brand", description: "Hires ÷ applications, for applications in the range.", definition: { dataset: "applications", dateField: "applied_at", groupBy: ["brand"], metrics: ["count", "hired", "hire_rate"], filters: [], visualization: "bar" } },
      { name: "Offer outcomes by department", description: null, definition: { dataset: "offers", dateField: "created_at", groupBy: ["department"], metrics: ["count", "accepted", "acceptance_rate"], filters: [], visualization: "bar" } },
    ];
    const reports = await db
      .insert(s.savedReports)
      .values(defs.map((d) => ({ ...d, ownerId: owner.id, visibility: "everyone" as const, filters: { range: "180d" } })))
      .returning();
    const [dash] = await db.insert(s.reportDashboards).values({ name: "Recruiting overview", description: "The weekly numbers for the recruiting team.", ownerId: owner.id, visibility: "everyone" }).returning();
    await db.insert(s.reportDashboardItems).values(reports.map((r, position) => ({ dashboardId: dash.id, reportId: r.id, position })));
  }

  const counts = await db.execute(sql`SELECT
    (SELECT count(*) FROM candidates) AS candidates,
    (SELECT count(*) FROM applications) AS applications,
    (SELECT count(*) FROM interviews) AS interviews,
    (SELECT count(*) FROM scorecards) AS scorecards,
    (SELECT count(*) FROM offers) AS offers`);
  console.log("Seeded:", counts.rows[0]);
  process.exit(0);
}

function jobTitleVariant(title: string) {
  const base = title.replace(/^(Senior|Staff|Junior|Associate|Chief)\s+/, "").replace(/\s*\(.*\)|\s*–.*$/, "");
  return pick(["", "", "Senior ", "Lead "]) + base;
}

function jobDescriptionFr(title: string, brand: string) {
  return `## À propos de ${brand}

${brand} fait partie de Purpose Unlimited, une société indépendante de gestion d'actifs et de services financiers axée sur la technologie. Nous bâtissons un meilleur avenir financier pour les Canadiens.

## Le poste

Nous recherchons une personne pour le poste de **${title}** au sein de notre équipe.

## Ce que vous ferez

- Prendre en charge des résultats concrets dès le premier jour
- Collaborer étroitement avec les équipes des placements, de la technologie et de la distribution
- Contribuer à façonner notre façon de travailler

## Ce que vous apportez

- Une expérience pertinente dans un rôle semblable
- Une communication claire et un bon jugement
- De la curiosité et le goût de l'action
`;
}

/** Canadian French versions of the default templates (ARCHITECTURE.md §7.2). */
const FR_TEMPLATES: (typeof s.emailTemplates.$inferInsert)[] = [
  {
    templateKey: "screen_invite",
    locale: "fr-CA",
    name: "Invitation à un premier appel (FR)",
    subject: "{{brand.name}} – discutons du poste de {{job.title}}",
    body: "Bonjour {{candidate.firstName}},\n\nMerci de votre intérêt pour le poste de {{job.title}} chez {{brand.name}}. J'aimerais planifier un appel de 30 minutes pour mieux vous connaître.\n\nCordialement,\n{{sender.name}}",
  },
  {
    templateKey: "rejection_review",
    locale: "fr-CA",
    name: "Refus – après examen de la candidature (FR)",
    subject: "Votre candidature chez {{brand.name}}",
    body: "Bonjour {{candidate.firstName}},\n\nMerci d'avoir postulé au poste de {{job.title}}. Après un examen attentif, nous avons décidé de poursuivre avec d'autres candidatures. Nous conserverons votre profil pour de futurs postes.\n\nBonne continuation,\n{{sender.name}}",
  },
  {
    templateKey: "outreach_sourced",
    locale: "fr-CA",
    name: "Approche – candidat recruté (FR)",
    subject: "{{job.title}} chez {{brand.name}}",
    body: "Bonjour {{candidate.firstName}},\n\nVotre parcours a retenu mon attention. Nous recrutons pour un poste de {{job.title}} chez {{brand.name}} et je pense que vous seriez un excellent choix. Seriez-vous ouvert à une brève discussion?\n\n{{sender.name}}",
  },
];

/**
 * Demo retention defaults (null brand = all brands). Real periods are a policy decision for
 * Legal/Privacy; these exist so the schema and worker have something to read.
 */
const DEMO_RETENTION: (typeof s.retentionPolicies.$inferInsert)[] = [
  { recordType: "candidate", retentionDays: 730 },
  { recordType: "archived_application", retentionDays: 730 },
  { recordType: "email", retentionDays: 730 },
  { recordType: "interview_feedback", retentionDays: 730 },
];

function jobDescription(title: string, brand: string) {
  return `## About ${brand}

${brand} is part of Purpose Unlimited, an independent technology-driven asset management and financial services company. We're building a better financial future for Canadians.

## The role

We're looking for a **${title}** to join our team. You'll work with a small, talented group on problems that matter to our clients.

## What you'll do

- Own meaningful outcomes from day one
- Partner closely with colleagues across investments, technology and distribution
- Help shape how we work as we grow

## What you bring

- Relevant experience in a similar role
- Clear communication and good judgment
- Curiosity and a bias to action

## Why Purpose

- Competitive compensation, bonus and benefits
- Hybrid work with offices across Canada
- A culture that values participation and ownership

*Purpose is committed to an inclusive, barrier-free recruitment process. Accommodations are available on request.*`;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
