CREATE TYPE "public"."queue_job_status" AS ENUM('queued', 'running', 'done', 'dead');--> statement-breakpoint
CREATE TABLE "graph_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"mailbox" text NOT NULL,
	"user_id" uuid,
	"client_state_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "graph_subscriptions_mailbox_unique" UNIQUE("mailbox")
);
--> statement-breakpoint
CREATE TABLE "job_queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "queue_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_queue_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "mail_sync_state" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"delta_link" text,
	"last_synced_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "graph_subscriptions" ADD CONSTRAINT "graph_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_queue_ready_idx" ON "job_queue" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "emails_thread_idx" ON "emails" USING btree ("external_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emails_inbound_message_uq" ON "emails" USING btree ("external_message_id") WHERE direction = 'inbound';