ALTER TYPE "public"."offer_status" ADD VALUE 'withdrawn';--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "sign_on_bonus" integer;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "equity" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "decline_reason" text;--> statement-breakpoint
ALTER TABLE "offers" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;