CREATE TYPE "public"."prospect_stage" AS ENUM('new', 'contacted', 'interested', 'not_interested', 'applied');--> statement-breakpoint
CREATE TABLE "talent_pool_members" (
	"pool_id" uuid NOT NULL,
	"candidate_id" uuid NOT NULL,
	"stage" "prospect_stage" DEFAULT 'new' NOT NULL,
	"added_by_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "talent_pool_members_pool_id_candidate_id_pk" PRIMARY KEY("pool_id","candidate_id")
);
--> statement-breakpoint
CREATE TABLE "talent_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"brand_id" uuid,
	"owner_id" uuid,
	"archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_pool_id_talent_pools_id_fk" FOREIGN KEY ("pool_id") REFERENCES "public"."talent_pools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_candidate_id_candidates_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."candidates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pool_members" ADD CONSTRAINT "talent_pool_members_added_by_id_users_id_fk" FOREIGN KEY ("added_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pools" ADD CONSTRAINT "talent_pools_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "talent_pools" ADD CONSTRAINT "talent_pools_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "talent_pool_members_candidate_idx" ON "talent_pool_members" USING btree ("candidate_id");