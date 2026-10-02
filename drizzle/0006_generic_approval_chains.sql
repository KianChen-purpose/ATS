CREATE TYPE "public"."approval_request_status" AS ENUM('pending', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."approval_step_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."approval_subject" AS ENUM('job', 'offer');--> statement-breakpoint
CREATE TYPE "public"."approver_type" AS ENUM('user', 'hiring_manager', 'recruiter');--> statement-breakpoint
CREATE TABLE "approval_chain_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"chain_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"approver_type" "approver_type" NOT NULL,
	"approver_id" uuid
);
--> statement-breakpoint
CREATE TABLE "approval_chains" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"subject" "approval_subject" NOT NULL,
	"brand_id" uuid,
	"department_id" uuid,
	"min_amount" integer,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" "approval_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"chain_id" uuid,
	"status" "approval_request_status" DEFAULT 'pending' NOT NULL,
	"requested_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "approval_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"approver_id" uuid NOT NULL,
	"status" "approval_step_status" DEFAULT 'pending' NOT NULL,
	"comment" text,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
-- Carry existing offer approvals into the generic model before dropping the old table.
INSERT INTO "approval_requests" ("id", "subject", "subject_id", "job_id", "status", "requested_by_id", "created_at", "completed_at")
SELECT gen_random_uuid(), 'offer', o.id, a.job_id,
  CASE WHEN bool_or(oa.status = 'rejected') THEN 'rejected'::approval_request_status
       WHEN bool_and(oa.status = 'approved') THEN 'approved'::approval_request_status
       ELSE 'pending'::approval_request_status END,
  o.created_by_id, o.created_at,
  CASE WHEN bool_or(oa.status = 'rejected') OR bool_and(oa.status = 'approved') THEN max(oa.decided_at) END
FROM "offer_approvals" oa
JOIN "offers" o ON o.id = oa.offer_id
JOIN "applications" a ON a.id = o.application_id
GROUP BY o.id, a.job_id, o.created_by_id, o.created_at;--> statement-breakpoint
INSERT INTO "approval_steps" ("request_id", "position", "approver_id", "status", "comment", "decided_at")
SELECT r.id, oa.position, oa.approver_id, oa.status::text::approval_step_status, oa.comment, oa.decided_at
FROM "offer_approvals" oa
JOIN "approval_requests" r ON r.subject = 'offer' AND r.subject_id = oa.offer_id;--> statement-breakpoint
DROP TABLE "offer_approvals" CASCADE;--> statement-breakpoint
ALTER TABLE "approval_chain_steps" ADD CONSTRAINT "approval_chain_steps_chain_id_approval_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."approval_chains"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chain_steps" ADD CONSTRAINT "approval_chain_steps_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chains" ADD CONSTRAINT "approval_chains_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_chains" ADD CONSTRAINT "approval_chains_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_chain_id_approval_chains_id_fk" FOREIGN KEY ("chain_id") REFERENCES "public"."approval_chains"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_id_users_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_request_id_approval_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."approval_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approver_id_users_id_fk" FOREIGN KEY ("approver_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_chain_steps_pos_uq" ON "approval_chain_steps" USING btree ("chain_id","position");--> statement-breakpoint
CREATE INDEX "approval_chains_subject_idx" ON "approval_chains" USING btree ("subject","active");--> statement-breakpoint
CREATE INDEX "approval_requests_subject_idx" ON "approval_requests" USING btree ("subject","subject_id");--> statement-breakpoint
CREATE INDEX "approval_requests_job_idx" ON "approval_requests" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_steps_pos_uq" ON "approval_steps" USING btree ("request_id","position");--> statement-breakpoint
CREATE INDEX "approval_steps_approver_idx" ON "approval_steps" USING btree ("approver_id","status");--> statement-breakpoint
DROP TYPE "public"."approval_status";