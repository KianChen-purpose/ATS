CREATE TYPE "public"."report_visibility" AS ENUM('private', 'people', 'everyone');--> statement-breakpoint
CREATE TABLE "report_dashboard_items" (
	"dashboard_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "report_dashboard_items_dashboard_id_report_id_pk" PRIMARY KEY("dashboard_id","report_id")
);
--> statement-breakpoint
CREATE TABLE "report_dashboard_shares" (
	"dashboard_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "report_dashboard_shares_dashboard_id_user_id_pk" PRIMARY KEY("dashboard_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "report_dashboards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"visibility" "report_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "saved_report_shares" (
	"report_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "saved_report_shares_report_id_user_id_pk" PRIMARY KEY("report_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "saved_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"owner_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"visibility" "report_visibility" DEFAULT 'private' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_dashboard_items" ADD CONSTRAINT "report_dashboard_items_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_items" ADD CONSTRAINT "report_dashboard_items_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."saved_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_dashboard_id_report_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."report_dashboards"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboard_shares" ADD CONSTRAINT "report_dashboard_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_dashboards" ADD CONSTRAINT "report_dashboards_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_report_shares" ADD CONSTRAINT "saved_report_shares_report_id_saved_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."saved_reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_report_shares" ADD CONSTRAINT "saved_report_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_reports" ADD CONSTRAINT "saved_reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_report_shares_user_idx" ON "saved_report_shares" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "saved_reports_owner_idx" ON "saved_reports" USING btree ("owner_id");