import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  boolean,
  timestamp,
  date,
  jsonb,
  primaryKey,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRole = pgEnum("user_role", [
  "admin",
  "recruiter",
  "coordinator",
  "hiring_manager",
  "interviewer",
  "executive",
]);

export const jobStatus = pgEnum("job_status", ["draft", "open", "on_hold", "closed"]);
export const employmentType = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
]);
export const workplaceType = pgEnum("workplace_type", ["onsite", "hybrid", "remote"]);

/** Ashby-style stage types. Every job's interview plan is an ordered list of stages, each with a type. */
export const stageType = pgEnum("stage_type", [
  "lead",
  "review",
  "screen",
  "interview",
  "offer",
  "hired",
]);

export const applicationStatus = pgEnum("application_status", ["active", "archived", "hired"]);
export const sourceCategory = pgEnum("source_category", [
  "inbound",
  "referral",
  "agency",
  "sourced",
  "internal",
]);
export const archiveCategory = pgEnum("archive_category", [
  "rejected",
  "withdrew",
  "other",
]);
export const openingStatus = pgEnum("opening_status", ["open", "filled", "closed"]);
export const openingReason = pgEnum("opening_reason", ["new_headcount", "backfill"]);

export const activityType = pgEnum("activity_type", [
  "note",
  "email",
  "stage_change",
  "application_created",
  "archived",
  "unarchived",
  "interview_scheduled",
  "interview_cancelled",
  "feedback_submitted",
  "offer_created",
  "offer_updated",
  "hired",
]);

export const interviewStatus = pgEnum("interview_status", [
  "scheduled",
  "completed",
  "cancelled",
]);
export const recommendation = pgEnum("recommendation", [
  "strong_no",
  "no",
  "yes",
  "strong_yes",
]);
export const offerStatus = pgEnum("offer_status", [
  "draft",
  "pending_approval",
  "approved",
  "sent",
  "accepted",
  "declined",
]);
export const approvalStatus = pgEnum("approval_status", ["pending", "approved", "rejected"]);
export const emailDirection = pgEnum("email_direction", ["outbound", "inbound"]);

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

/** Purpose Unlimited brands (Purpose Investments, Steadyhand, ...). Each gets its own career site. */
export const brands = pgTable("brands", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  primaryColor: text("primary_color").notNull().default("#4f46e5"),
  websiteUrl: text("website_url"),
  tagline: text("tagline"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const departments = pgTable("departments", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => departments.id),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  city: text("city"),
  region: text("region"),
  country: text("country").notNull().default("Canada"),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  title: text("title"),
  role: userRole("role").notNull().default("interviewer"),
  /** Entra ID object id once SSO/SCIM is connected. */
  entraObjectId: text("entra_object_id").unique(),
  managerId: uuid("manager_id").references((): AnyPgColumn => users.id),
  timezone: text("timezone").notNull().default("America/Toronto"),
  avatarColor: text("avatar_color").notNull().default("#6366f1"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => brands.id),
    departmentId: uuid("department_id").references(() => departments.id),
    locationId: uuid("location_id").references(() => locations.id),
    status: jobStatus("status").notNull().default("draft"),
    employmentType: employmentType("employment_type").notNull().default("full_time"),
    workplaceType: workplaceType("workplace_type").notNull().default("hybrid"),
    confidential: boolean("confidential").notNull().default(false),
    compMin: integer("comp_min"),
    compMax: integer("comp_max"),
    currency: text("currency").notNull().default("CAD"),
    /** Markdown job description, shown on the career site. */
    description: text("description"),
    publishedOnCareerSite: boolean("published_on_career_site").notNull().default(false),
    hiringManagerId: uuid("hiring_manager_id").references(() => users.id),
    recruiterId: uuid("recruiter_id").references(() => users.id),
    coordinatorId: uuid("coordinator_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("jobs_status_idx").on(t.status), index("jobs_brand_idx").on(t.brandId)],
);

/** The job's interview plan: ordered stages. */
export const jobStages = pgTable(
  "job_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: stageType("type").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [index("job_stages_job_idx").on(t.jobId)],
);

/** Hiring team members beyond the named HM/recruiter/coordinator (e.g. interviewers, observers). */
export const jobHiringTeam = pgTable(
  "job_hiring_team",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    teamRole: text("team_role").notNull().default("interviewer"),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.userId] })],
);

export const openings = pgTable("openings", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  code: text("code").notNull().unique(),
  status: openingStatus("status").notNull().default("open"),
  reason: openingReason("reason").notNull().default("new_headcount"),
  targetStartDate: date("target_start_date"),
  filledAt: timestamp("filled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Candidates & applications
// ---------------------------------------------------------------------------

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: text("email"),
    phone: text("phone"),
    location: text("location"),
    currentTitle: text("current_title"),
    currentCompany: text("current_company"),
    linkedinUrl: text("linkedin_url"),
    websiteUrl: text("website_url"),
    tags: text("tags").array().notNull().default([]),
    /** Plain-text resume content (parsed), used for search. */
    resumeText: text("resume_text"),
    resumeFileName: text("resume_file_name"),
    ownerId: uuid("owner_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("candidates_email_idx").on(t.email)],
);

export const sources = pgTable("sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  category: sourceCategory("category").notNull(),
});

export const archiveReasons = pgTable("archive_reasons", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  category: archiveCategory("category").notNull(),
});

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => jobStages.id),
    status: applicationStatus("status").notNull().default("active"),
    sourceId: uuid("source_id").references(() => sources.id),
    creditedToId: uuid("credited_to_id").references(() => users.id),
    referrerId: uuid("referrer_id").references(() => users.id),
    archiveReasonId: uuid("archive_reason_id").references(() => archiveReasons.id),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    stageEnteredAt: timestamp("stage_entered_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    hiredAt: timestamp("hired_at", { withTimezone: true }),
  },
  (t) => [
    index("applications_job_idx").on(t.jobId),
    index("applications_candidate_idx").on(t.candidateId),
    uniqueIndex("applications_candidate_job_uq").on(t.candidateId, t.jobId),
  ],
);

/** Immutable stage history. Powers time-in-stage, funnel and point-in-time reporting. */
export const applicationStageEvents = pgTable(
  "application_stage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    fromStageId: uuid("from_stage_id").references(() => jobStages.id),
    toStageId: uuid("to_stage_id").references(() => jobStages.id),
    /** Status after this event, so archive/hire transitions are captured too. */
    status: applicationStatus("status").notNull(),
    movedById: uuid("moved_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stage_events_app_idx").on(t.applicationId)],
);

/** Candidate timeline: notes, emails, stage moves, interviews, feedback, offers. */
export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").references(() => applications.id, {
      onDelete: "cascade",
    }),
    type: activityType("type").notNull(),
    actorId: uuid("actor_id").references(() => users.id),
    body: text("body"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("activities_candidate_idx").on(t.candidateId, t.createdAt)],
);

// ---------------------------------------------------------------------------
// Interviews & feedback
// ---------------------------------------------------------------------------

export const feedbackForms = pgTable("feedback_forms", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  /** Ordered list of attributes to rate, e.g. [{ key: "communication", label: "Communication" }]. */
  attributes: jsonb("attributes")
    .$type<{ key: string; label: string; description?: string }[]>()
    .notNull()
    .default([]),
});

export const interviews = pgTable(
  "interviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id").references(() => jobStages.id),
    feedbackFormId: uuid("feedback_form_id").references(() => feedbackForms.id),
    title: text("title").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    location: text("location"),
    meetingUrl: text("meeting_url"),
    /** Outlook event id once created via Microsoft Graph. */
    externalEventId: text("external_event_id"),
    status: interviewStatus("status").notNull().default("scheduled"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("interviews_app_idx").on(t.applicationId), index("interviews_start_idx").on(t.startAt)],
);

export const interviewInterviewers = pgTable(
  "interview_interviewers",
  {
    interviewId: uuid("interview_id")
      .notNull()
      .references(() => interviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
  },
  (t) => [primaryKey({ columns: [t.interviewId, t.userId] })],
);

export const scorecards = pgTable(
  "scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    interviewId: uuid("interview_id").references(() => interviews.id, { onDelete: "set null" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id),
    overall: recommendation("overall").notNull(),
    /** attribute key -> 1..4 rating */
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default({}),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scorecards_app_idx").on(t.applicationId)],
);

// ---------------------------------------------------------------------------
// Offers
// ---------------------------------------------------------------------------

export const offers = pgTable("offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  applicationId: uuid("application_id")
    .notNull()
    .references(() => applications.id, { onDelete: "cascade" }),
  openingId: uuid("opening_id").references(() => openings.id),
  status: offerStatus("status").notNull().default("draft"),
  baseSalary: integer("base_salary").notNull(),
  bonusPercent: integer("bonus_percent"),
  currency: text("currency").notNull().default("CAD"),
  startDate: date("start_date"),
  notes: text("notes"),
  createdById: uuid("created_by_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

export const offerApprovals = pgTable("offer_approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => offers.id, { onDelete: "cascade" }),
  approverId: uuid("approver_id")
    .notNull()
    .references(() => users.id),
  position: integer("position").notNull(),
  status: approvalStatus("status").notNull().default("pending"),
  comment: text("comment"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// Communication
// ---------------------------------------------------------------------------

export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  subject: text("subject").notNull(),
  /** Supports {{candidate.firstName}}, {{job.title}}, {{brand.name}}, {{sender.name}} merge fields. */
  body: text("body").notNull(),
  brandId: uuid("brand_id").references(() => brands.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => candidates.id, { onDelete: "cascade" }),
    direction: emailDirection("direction").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    sentById: uuid("sent_by_id").references(() => users.id),
    /** Graph conversationId / internetMessageId for thread sync. */
    externalThreadId: text("external_thread_id"),
    externalMessageId: text("external_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("emails_candidate_idx").on(t.candidateId)],
);

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId)],
);

/** Every call PATS makes to Microsoft 365 (real or mocked), so the demo can show integration traffic. */
export const integrationEvents = pgTable("integration_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(), // "m365"
  service: text("service").notNull(), // "mail" | "calendar" | "teams" | "sharepoint" | "directory"
  operation: text("operation").notNull(),
  mode: text("mode").notNull(), // "mock" | "live"
  success: boolean("success").notNull().default(true),
  summary: text("summary"),
  request: jsonb("request").$type<Record<string, unknown>>().notNull().default({}),
  response: jsonb("response").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Relations (for db.query.* nested loading)
// ---------------------------------------------------------------------------

export const brandsRelations = relations(brands, ({ many }) => ({ jobs: many(jobs) }));

export const usersRelations = relations(users, ({ one }) => ({
  manager: one(users, { fields: [users.managerId], references: [users.id] }),
}));

export const jobsRelations = relations(jobs, ({ one, many }) => ({
  brand: one(brands, { fields: [jobs.brandId], references: [brands.id] }),
  department: one(departments, { fields: [jobs.departmentId], references: [departments.id] }),
  location: one(locations, { fields: [jobs.locationId], references: [locations.id] }),
  hiringManager: one(users, { fields: [jobs.hiringManagerId], references: [users.id], relationName: "jobHM" }),
  recruiter: one(users, { fields: [jobs.recruiterId], references: [users.id], relationName: "jobRecruiter" }),
  coordinator: one(users, { fields: [jobs.coordinatorId], references: [users.id], relationName: "jobCoordinator" }),
  stages: many(jobStages),
  openings: many(openings),
  team: many(jobHiringTeam),
  applications: many(applications),
}));

export const jobStagesRelations = relations(jobStages, ({ one }) => ({
  job: one(jobs, { fields: [jobStages.jobId], references: [jobs.id] }),
}));

export const jobHiringTeamRelations = relations(jobHiringTeam, ({ one }) => ({
  job: one(jobs, { fields: [jobHiringTeam.jobId], references: [jobs.id] }),
  user: one(users, { fields: [jobHiringTeam.userId], references: [users.id] }),
}));

export const openingsRelations = relations(openings, ({ one }) => ({
  job: one(jobs, { fields: [openings.jobId], references: [jobs.id] }),
}));

export const candidatesRelations = relations(candidates, ({ one, many }) => ({
  owner: one(users, { fields: [candidates.ownerId], references: [users.id] }),
  applications: many(applications),
  activities: many(activities),
  emails: many(emails),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  candidate: one(candidates, { fields: [applications.candidateId], references: [candidates.id] }),
  job: one(jobs, { fields: [applications.jobId], references: [jobs.id] }),
  stage: one(jobStages, { fields: [applications.stageId], references: [jobStages.id] }),
  source: one(sources, { fields: [applications.sourceId], references: [sources.id] }),
  creditedTo: one(users, { fields: [applications.creditedToId], references: [users.id], relationName: "appCredited" }),
  referrer: one(users, { fields: [applications.referrerId], references: [users.id], relationName: "appReferrer" }),
  archiveReason: one(archiveReasons, { fields: [applications.archiveReasonId], references: [archiveReasons.id] }),
  interviews: many(interviews),
  scorecards: many(scorecards),
  offers: many(offers),
  stageEvents: many(applicationStageEvents),
}));

export const applicationStageEventsRelations = relations(applicationStageEvents, ({ one }) => ({
  application: one(applications, { fields: [applicationStageEvents.applicationId], references: [applications.id] }),
}));

export const activitiesRelations = relations(activities, ({ one }) => ({
  candidate: one(candidates, { fields: [activities.candidateId], references: [candidates.id] }),
  application: one(applications, { fields: [activities.applicationId], references: [applications.id] }),
  actor: one(users, { fields: [activities.actorId], references: [users.id] }),
}));

export const interviewsRelations = relations(interviews, ({ one, many }) => ({
  application: one(applications, { fields: [interviews.applicationId], references: [applications.id] }),
  stage: one(jobStages, { fields: [interviews.stageId], references: [jobStages.id] }),
  feedbackForm: one(feedbackForms, { fields: [interviews.feedbackFormId], references: [feedbackForms.id] }),
  interviewers: many(interviewInterviewers),
  scorecards: many(scorecards),
}));

export const interviewInterviewersRelations = relations(interviewInterviewers, ({ one }) => ({
  interview: one(interviews, { fields: [interviewInterviewers.interviewId], references: [interviews.id] }),
  user: one(users, { fields: [interviewInterviewers.userId], references: [users.id] }),
}));

export const scorecardsRelations = relations(scorecards, ({ one }) => ({
  application: one(applications, { fields: [scorecards.applicationId], references: [applications.id] }),
  interview: one(interviews, { fields: [scorecards.interviewId], references: [interviews.id] }),
  author: one(users, { fields: [scorecards.authorId], references: [users.id] }),
}));

export const offersRelations = relations(offers, ({ one, many }) => ({
  application: one(applications, { fields: [offers.applicationId], references: [applications.id] }),
  opening: one(openings, { fields: [offers.openingId], references: [openings.id] }),
  createdBy: one(users, { fields: [offers.createdById], references: [users.id] }),
  approvals: many(offerApprovals),
}));

export const offerApprovalsRelations = relations(offerApprovals, ({ one }) => ({
  offer: one(offers, { fields: [offerApprovals.offerId], references: [offers.id] }),
  approver: one(users, { fields: [offerApprovals.approverId], references: [users.id] }),
}));

export const emailsRelations = relations(emails, ({ one }) => ({
  candidate: one(candidates, { fields: [emails.candidateId], references: [candidates.id] }),
  sentBy: one(users, { fields: [emails.sentById], references: [users.id] }),
}));
