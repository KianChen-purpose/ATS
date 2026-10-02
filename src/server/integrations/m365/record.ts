import { db, schema } from "@/db";
import type { IntegrationMode } from "./types";

/**
 * Log every M365 call so admins (and demos) can see integration traffic in Settings → Integrations.
 *
 * Privacy (ARCHITECTURE.md §4.6): this log stores the operation, status, ids and recipient
 * *domains* only. The input type has no free-text field on purpose: subjects, bodies, names
 * and full addresses can't be passed in.
 */
export type IntegrationEventInput = {
  service: "mail" | "calendar" | "teams" | "sharepoint" | "directory";
  operation: string;
  mode: IntegrationMode;
  success?: boolean;
  /** Email addresses involved; only their domains are stored. */
  recipients?: string[];
  /** Provider ids (message, thread, event) for correlating with Graph. */
  ids?: Record<string, string | null | undefined>;
  /** Non-identifying numbers/flags, e.g. { attendees: 3, teamsMeeting: 1 }. */
  counts?: Record<string, number>;
  /** Error from the provider; email addresses are redacted and it is truncated. */
  error?: unknown;
};

const EMAIL_RE = /[A-Z0-9._%+-]+@([A-Z0-9.-]+\.[A-Z]{2,})/gi;

export function domainsOf(addresses: string[] = []) {
  return [...new Set(addresses.map((a) => a.split("@")[1]?.toLowerCase()).filter(Boolean))].sort();
}

export function redact(text: string) {
  return text.replace(EMAIL_RE, "…@$1").slice(0, 300);
}

export function integrationEventRow(e: IntegrationEventInput) {
  const domains = domainsOf(e.recipients);
  const n = e.recipients?.length ?? 0;
  const parts = [e.operation];
  if (n) parts.push(`${n} recipient${n === 1 ? "" : "s"} @ ${domains.join(", ")}`);
  for (const [k, v] of Object.entries(e.counts ?? {})) parts.push(`${k}: ${v}`);
  const ids = Object.fromEntries(Object.entries(e.ids ?? {}).filter(([, v]) => v != null)) as Record<string, string>;
  return {
    provider: "m365",
    service: e.service,
    operation: e.operation,
    mode: e.mode,
    success: e.success ?? true,
    summary: (e.success === false ? "FAILED: " : "") + parts.join(" · "),
    request: { recipientDomains: domains, recipientCount: n, ...(e.counts ?? {}) },
    response: e.error !== undefined ? { ...ids, error: redact(String(e.error)) } : ids,
  };
}

export async function recordIntegrationEvent(e: IntegrationEventInput) {
  try {
    await db.insert(schema.integrationEvents).values(integrationEventRow(e));
  } catch (err) {
    console.error("Failed to record integration event", err);
  }
}
