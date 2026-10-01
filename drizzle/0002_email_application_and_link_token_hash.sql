ALTER TABLE "scheduling_links" DROP CONSTRAINT "scheduling_links_token_unique";--> statement-breakpoint
ALTER TABLE "emails" ADD COLUMN "application_id" uuid;--> statement-breakpoint
-- Backfill: emails of candidates with exactly one application belong to that application.
UPDATE "emails" e SET "application_id" = a.id
FROM (SELECT candidate_id, min(id::text)::uuid AS id FROM "applications" GROUP BY candidate_id HAVING count(*) = 1) a
WHERE a.candidate_id = e.candidate_id;--> statement-breakpoint
ALTER TABLE "scheduling_links" ADD COLUMN "token_hash" text;--> statement-breakpoint
-- Existing links keep working: store the SHA-256 of the token, then drop the plaintext.
UPDATE "scheduling_links" SET "token_hash" = encode(sha256(convert_to("token", 'UTF8')), 'hex');--> statement-breakpoint
ALTER TABLE "scheduling_links" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "emails" ADD CONSTRAINT "emails_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "emails_application_idx" ON "emails" USING btree ("application_id");--> statement-breakpoint
ALTER TABLE "scheduling_links" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "scheduling_links" ADD CONSTRAINT "scheduling_links_token_hash_unique" UNIQUE("token_hash");
