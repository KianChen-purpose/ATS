CREATE TABLE "teams_card_messages" (
	"step_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"activity_id" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "teams_conversations" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"aad_object_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"service_url" text NOT NULL,
	"tenant_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "teams_card_messages" ADD CONSTRAINT "teams_card_messages_step_id_approval_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."approval_steps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_card_messages" ADD CONSTRAINT "teams_card_messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams_conversations" ADD CONSTRAINT "teams_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;