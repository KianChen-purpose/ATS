ALTER TABLE "audit_logs" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "ip" text;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "user_agent" text;--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_logs" USING btree ("actor_id","created_at");--> statement-breakpoint
-- ARCHITECTURE.md §4.1/§4.4: audit_logs and application_stage_events are append-only.
-- Row-level UPDATE/DELETE is rejected for every role. (Production also grants the app role
-- only INSERT/SELECT on these tables; TRUNCATE is reserved for local demo resets.)
CREATE OR REPLACE FUNCTION pats_reject_history_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION pats_reject_history_change();--> statement-breakpoint
CREATE TRIGGER application_stage_events_append_only BEFORE UPDATE OR DELETE ON "application_stage_events"
  FOR EACH ROW EXECUTE FUNCTION pats_reject_history_change();--> statement-breakpoint
-- §4.6: integration_events must not hold PII. Scrub rows written before this rule was enforced.
UPDATE "integration_events" SET "summary" = "operation", "request" = '{}'::jsonb, "response" = '{}'::jsonb;
