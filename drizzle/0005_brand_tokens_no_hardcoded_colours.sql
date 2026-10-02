ALTER TABLE "brands" ALTER COLUMN "primary_color" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "primary_color" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "avatar_color";--> statement-breakpoint
-- The old placeholder default (indigo) was never a Purpose colour.
UPDATE "brands" SET "primary_color" = NULL WHERE "primary_color" = '#4f46e5';
