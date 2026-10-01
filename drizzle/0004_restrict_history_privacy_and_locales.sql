CREATE TYPE "public"."consent_purpose" AS ENUM('application_processing', 'talent_pool', 'marketing');--> statement-breakpoint
CREATE TYPE "public"."consent_source" AS ENUM('career_site', 'recruiter', 'referral', 'import', 'email');--> statement-breakpoint
CREATE TYPE "public"."dsr_status" AS ENUM('received', 'verifying', 'in_progress', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."dsr_type" AS ENUM('access', 'correction', 'deletion');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('en', 'fr-CA');--> statement-breakpoint
CREATE TYPE "public"."retention_record_type" AS ENUM('candidate', 'archived_application', 'email', 'interview_feedback');--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"purpose" "consent_purpose" NOT NULL,
	"granted" boolean NOT NULL,
	"policy_version" text NOT NULL,
	"locale" "locale" DEFAULT 'en' NOT NULL,
	"source" "consent_source" NOT NULL,
	"recorded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "data_subject_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid,
	"requester_email" text NOT NULL,
	"type" "dsr_type" NOT NULL,
	"status" "dsr_status" DEFAULT 'received' NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"handled_by_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_translations" (
	"job_id" uuid NOT NULL,
	"locale" "locale" NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_translations_job_id_locale_pk" PRIMARY KEY("job_id","locale")
);
--> statement-breakpoint
CREATE TABLE "retention_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" uuid,
	"record_type" "retention_record_type" NOT NULL,
	"retention_days" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "retention_brand_type_uq" UNIQUE NULLS NOT DISTINCT("brand_id","record_type")
);
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "activities" DROP CONSTRAINT "activities_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "application_stage_events" DROP CONSTRAINT "application_stage_events_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "applications" DROP CONSTRAINT "applications_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "emails" DROP CONSTRAINT "emails_candidate_id_candidates_id_fk";
--> statement-breakpoint
ALTER TABLE "interview_interviewers" DROP CONSTRAINT "interview_interviewers_interview_id_interviews_id_fk";
--> statement-breakpoint
ALTER TABLE "interviews" DROP CONSTRAINT "interviews_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "job_hiring_team" DROP CONSTRAINT "job_hiring_team_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "job_stages" DROP CONSTRAINT "job_stages_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "offer_approvals" DROP CONSTRAINT "offer_approvals_offer_id_offers_id_fk";
--> statement-breakpoint
ALTER TABLE "offers" DROP CONSTRAINT "offers_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "openings" DROP CONSTRAINT "openings_job_id_jobs_id_fk";
--> statement-breakpoint
ALTER TABLE "scheduling_links" DROP CONSTRAINT "scheduling_links_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "scorecards" DROP CONSTRAINT "scorecards_application_id_applications_id_fk";
--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "preferred_locale" "locale" DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "candidates" ADD COLUMN "anonymized_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "locale" "locale" DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_templates" ADD COLUMN "template_key" text;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_recorded_by_id_users_id_fk" FOREIGN KEY ("recorded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_subject_requests" ADD CONSTRAINT "data_subject_requests_handled_by_id_users_id_fk" FOREIGN KEY ("handled_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_translations" ADD CONSTRAINT "job_translations_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_candidate_idx" ON "consent_records" USING btree ("candidate_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "dsr_status_idx" ON "data_subject_requests" USING btree ("status","due_at");--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "application_stage_events" ADD CONSTRAINT "application_stage_events_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_interviewers" ADD CONSTRAINT "interview_interviewers_interview_id_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."interviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interviews" ADD CONSTRAINT "interviews_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_hiring_team" ADD CONSTRAINT "job_hiring_team_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_stages" ADD CONSTRAINT "job_stages_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_approvals" ADD CONSTRAINT "offer_approvals_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "openings" ADD CONSTRAINT "openings_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduling_links" ADD CONSTRAINT "scheduling_links_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scorecards" ADD CONSTRAINT "scorecards_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Consent is evidence: grants and withdrawals are new rows, never edits.
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON "consent_records"
  FOR EACH ROW EXECUTE FUNCTION pats_reject_history_change();
