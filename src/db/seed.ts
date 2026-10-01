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
    "integration_events",
    "scheduling_links",
    "audit_logs",
    "emails",
    "email_templates",
    "offer_approvals",
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
}

const BRANDS = [
  { name: "Purpose Investments", slug: "purpose-investments", primaryColor: "#0f4c81", tagline: "Investing in a better future" },
  { name: "Purpose Advisor Solutions", slug: "purpose-advisor-solutions", primaryColor: "#2563eb", tagline: "Built for independent advisors" },
  { name: "Steadyhand", slug: "steadyhand", primaryColor: "#0d9488", tagline: "Investing made simple" },
  { name: "Harness Investment Management", slug: "harness", primaryColor: "#7c3aed", tagline: "Disciplined, data-driven investing" },
  { name: "Driven", slug: "driven", primaryColor: "#ea580c", tagline: "Wealth for the next generation" },
  { name: "Foundation Wealth Partners", slug: "foundation-wealth", primaryColor: "#b45309", tagline: "Partners in your wealth" },
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

const AVATAR_COLORS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

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
      USERS.map((u, i) => ({
        ...u,
        email: `${u.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]+/g, ".")}@purpose.demo`,
        avatarColor: AVATAR_COLORS[i % AVATAR_COLORS.length],
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

  await db.insert(s.emailTemplates).values([
    {
      name: "Recruiter screen invite",
      subject: "{{brand.name}} – let's chat about the {{job.title}} role",
      body: "Hi {{candidate.firstName}},\n\nThanks for your interest in the {{job.title}} role at {{brand.name}}. I'd love to set up a 30-minute call to learn more about you.\n\nBest,\n{{sender.name}}",
    },
    {
      name: "Rejection – after application review",
      subject: "Your application to {{brand.name}}",
      body: "Hi {{candidate.firstName}},\n\nThank you for applying for the {{job.title}} role. After careful review we've decided to move forward with other candidates. We'll keep your profile on file for future roles.\n\nAll the best,\n{{sender.name}}",
    },
    {
      name: "Outreach – sourced candidate",
      subject: "{{job.title}} at {{brand.name}}",
      body: "Hi {{candidate.firstName}},\n\nYour background caught my eye. We're hiring a {{job.title}} at {{brand.name}} and I think you'd be a great fit. Open to a quick chat?\n\n{{sender.name}}",
    },
  ]);

  console.log("Creating jobs…");
  let openingSeq = 1000;
  const jobRows: { job: typeof s.jobs.$inferSelect; stages: (typeof s.jobStages.$inferSelect)[]; dept: string }[] = [];
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
        reason: pick(["new_headcount", "new_headcount", "backfill"] as const),
        targetStartDate: new Date(now + faker.number.int({ min: 20, max: 120 }) * DAY).toISOString().slice(0, 10),
      })),
    );
    const team = faker.helpers.arrayElements(interviewers.filter((u) => u.id !== job.hiringManagerId), 3);
    await db.insert(s.jobHiringTeam).values(team.map((u) => ({ jobId: job.id, userId: u.id })));
    jobRows.push({ job, stages, dept: j.dept });
  }

  console.log("Creating candidates & applications…");
  const activeJobs = jobRows.filter((r) => r.job.status !== "draft");
  // Funnel shape: how far applications progress. Index = furthest stage position reached.
  const reachWeights = [6, 34, 22, 15, 9, 7, 4, 3];

  for (let i = 0; i < 320; i++) {
    const { job, stages, dept } = pick(activeJobs);
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    const skills = faker.helpers.arrayElements(SKILLS_BY_DEPT[dept] ?? ["Communication"], { min: 2, max: 4 });
    const company = pick(COMPANIES);
    const title = jobTitleVariant(job.title);
    const source = weightedPick(sources, SOURCE_WEIGHTS);
    const openedAgo = Math.floor((now - (job.openedAt ?? job.createdAt).getTime()) / DAY);
    const appliedAgo = faker.number.int({ min: 1, max: Math.max(2, openedAgo) });

    const [cand] = await db
      .insert(s.candidates)
      .values({
        firstName,
        lastName,
        email: faker.internet.email({ firstName, lastName }).toLowerCase(),
        phone: faker.phone.number({ style: "national" }),
        location: pick(LOCATIONS).name,
        currentTitle: title,
        currentCompany: company,
        linkedinUrl: `https://www.linkedin.com/in/${firstName}-${lastName}-${faker.string.alphanumeric(5)}`.toLowerCase(),
        tags: skills,
        resumeText: `${firstName} ${lastName}\n${title} at ${company}\n\nSkills: ${skills.join(", ")}\n\n${faker.lorem.paragraphs(2)}`,
        resumeFileName: `${firstName}_${lastName}_Resume.pdf`,
        ownerId: job.recruiterId,
        createdAt: daysAgo(appliedAgo),
        updatedAt: daysAgo(Math.max(0, appliedAgo - 3)),
      })
      .returning();

    // Sourced candidates start at Lead; inbound at Application Review.
    const startPos = source.category === "sourced" ? 0 : 1;
    let reach = Math.max(startPos, weightedPick([0, 1, 2, 3, 4, 5, 6, 7], reachWeights));
    if (job.status === "on_hold") reach = Math.min(reach, 3);

    // Walk through stages, spreading time across the elapsed window.
    const path = stages.filter((st) => st.position >= startPos && st.position <= reach);
    const stepDays = appliedAgo / (path.length + 1);
    const events: (typeof s.applicationStageEvents.$inferInsert)[] = [];
    const recruiter = job.recruiterId!;
    let t = appliedAgo;

    const isHired = reach === 7;
    // Applications that stopped before the end: most are archived, recent ones are still active.
    const archived = !isHired && (appliedAgo > 12 ? faker.number.float() < 0.62 : faker.number.float() < 0.15);
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
          : faker.helpers.arrayElements([...interviewers.filter((u) => u.id !== job.hiringManagerId), userByName[users.find((u) => u.id === job.hiringManagerId)!.name]], st.name === "Final Interviews" ? 3 : 1);
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
          baseSalary: Math.round(faker.number.int({ min: job.compMin!, max: job.compMax! }) / 1000) * 1000,
          bonusPercent: pick([10, 15, 20]),
          startDate: new Date(now + faker.number.int({ min: 14, max: 60 }) * DAY).toISOString().slice(0, 10),
          createdById: recruiter,
          createdAt: offerAt,
          sentAt: ["sent", "accepted", "declined"].includes(offerStatus) ? new Date(offerAt.getTime() + 2 * DAY) : null,
          decidedAt: ["accepted", "declined"].includes(offerStatus) ? new Date(offerAt.getTime() + 5 * DAY) : null,
        })
        .returning();
      const approvers = [users.find((u) => u.id === job.hiringManagerId)!, userByName["James Carter"]];
      await db.insert(s.offerApprovals).values(
        approvers.map((a, idx) => ({
          offerId: offer.id,
          approverId: a.id,
          position: idx,
          status: offerStatus === "pending_approval" && idx === 1 ? ("pending" as const) : ("approved" as const),
          decidedAt: offerStatus === "pending_approval" && idx === 1 ? null : new Date(offerAt.getTime() + (idx + 1) * 0.5 * DAY),
        })),
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

  // Mark openings filled for hires.
  await db.execute(sql`
    UPDATE openings o SET status = 'filled', filled_at = now()
    WHERE o.id IN (
      SELECT DISTINCT ON (a.id) o2.id FROM applications a
      JOIN openings o2 ON o2.job_id = a.job_id
      WHERE a.status = 'hired'
      ORDER BY a.id, o2.code
    )`);

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
