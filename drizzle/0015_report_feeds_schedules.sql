CREATE TYPE "public"."report_format" AS ENUM('xlsx', 'csv');--> statement-breakpoint
CREATE TYPE "public"."report_frequency" AS ENUM('daily', 'weekly', 'monthly');--> statement-breakpoint
CREATE TABLE "report_feed_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_feed_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "report_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"report_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"frequency" "report_frequency" DEFAULT 'weekly' NOT NULL,
	"day_of_week" integer,
	"day_of_month" integer,
	"hour" integer DEFAULT 8 NOT NULL,
	"timezone" text DEFAULT 'America/Toronto' NOT NULL,
	"format" "report_format" DEFAULT 'xlsx' NOT NULL,
	"recipient_ids" uuid[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_run_at" timestamp with time zone NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_feed_tokens" ADD CONSTRAINT "report_feed_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."saved_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD CONSTRAINT "report_schedules_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_feed_tokens_user_idx" ON "report_feed_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "report_schedules_due_idx" ON "report_schedules" USING btree ("active","next_run_at");--> statement-breakpoint
CREATE INDEX "report_schedules_report_idx" ON "report_schedules" USING btree ("report_id");