import { db, schema } from "@/db";
import type { IntegrationMode } from "./types";

/** Log every M365 call so admins (and demos) can see integration traffic in Settings → Integrations. */
export async function recordIntegrationEvent(e: {
  service: "mail" | "calendar" | "teams" | "sharepoint" | "directory";
  operation: string;
  mode: IntegrationMode;
  success?: boolean;
  summary: string;
  request?: Record<string, unknown>;
  response?: Record<string, unknown>;
}) {
  try {
    await db.insert(schema.integrationEvents).values({
      provider: "m365",
      service: e.service,
      operation: e.operation,
      mode: e.mode,
      success: e.success ?? true,
      summary: e.summary,
      request: e.request ?? {},
      response: e.response ?? {},
    });
  } catch (err) {
    console.error("Failed to record integration event", err);
  }
}
