CREATE TABLE "user_oauth_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'entra' NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"scopes" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_oauth_tokens" ADD CONSTRAINT "user_oauth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;