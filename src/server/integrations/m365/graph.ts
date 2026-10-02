import { recordIntegrationEvent } from "./record";
import type { BusyBlock, M365Client } from "./types";

/**
 * Live Microsoft Graph client (app-only, client-credentials flow).
 * Required application permissions (admin consent): Mail.Send, Calendars.ReadWrite,
 * OnlineMeetings.ReadWrite.All (via Calendars + isOnlineMeeting), User.Read.All,
 * TeamsActivity.Send. Scope mailbox access with an Exchange Application Access Policy.
 */
const GRAPH = "https://graph.microsoft.com/v1.0";
let tokenCache: { token: string; exp: number } | null = null;

async function token() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const res = await fetch(`https://login.microsoftonline.com/${process.env.M365_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.M365_CLIENT_ID!,
      client_secret: process.env.M365_CLIENT_SECRET!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Entra token request failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: json.access_token, exp: Date.now() + json.expires_in * 1000 };
  return tokenCache.token;
}

const MAX_ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Graph request that honours 429/503 Retry-After with exponential backoff (ARCHITECTURE.md §8.3). */
async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${GRAPH}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", ...init.headers },
    });
    if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2 ** attempt * 500);
      continue;
    }
    if (!res.ok) throw new Error(`Graph ${init.method ?? "GET"} ${path.split("/")[1]} failed: ${res.status} ${await res.text()}`);
    return (res.status === 202 || res.status === 204 ? undefined : await res.json()) as T;
  }
}

async function logged<T>(
  service: "mail" | "calendar" | "teams",
  operation: string,
  recipients: string[],
  fn: () => Promise<T>,
  ids: (out: T) => Record<string, string | null | undefined> = () => ({}),
): Promise<T> {
  try {
    const out = await fn();
    await recordIntegrationEvent({ service, operation, mode: "live", recipients, ids: ids(out) });
    return out;
  } catch (err) {
    await recordIntegrationEvent({ service, operation, mode: "live", success: false, recipients, error: err });
    throw err;
  }
}

export const graphM365: M365Client = {
  mode: "live",
  mail: {
    send(input) {
      return logged("mail", "sendMail", [input.to, ...(input.cc ?? [])], async () => {
        // Create as draft first so we get ids back for thread sync, then send.
        const draft = await graph<{ id: string; conversationId: string }>(`/users/${encodeURIComponent(input.from)}/messages`, {
          method: "POST",
          body: JSON.stringify({
            subject: input.subject,
            body: { contentType: "Text", content: input.body },
            toRecipients: [{ emailAddress: { address: input.to } }],
            ccRecipients: (input.cc ?? []).map((address) => ({ emailAddress: { address } })),
            // Inline file attachments (up to 3 MB each); larger files need an upload session.
            attachments: (input.attachments ?? []).map((a) => ({
              "@odata.type": "#microsoft.graph.fileAttachment",
              name: a.name,
              contentType: a.contentType,
              contentBytes: a.bytes.toString("base64"),
            })),
          }),
        });
        await graph(`/users/${encodeURIComponent(input.from)}/messages/${draft.id}/send`, { method: "POST" });
        return { messageId: draft.id, threadId: draft.conversationId };
      }, (r) => r);
    },
  },
  calendar: {
    getSchedule(emails, start, end) {
      return logged("calendar", "getSchedule", emails, async () => {
        const res = await graph<{ value: { scheduleId: string; scheduleItems: { status: string; start: { dateTime: string }; end: { dateTime: string } }[] }[] }>(
          `/users/${encodeURIComponent(process.env.M365_SENDER_MAILBOX || emails[0])}/calendar/getSchedule`,
          {
            method: "POST",
            headers: { Prefer: 'outlook.timezone="UTC"' },
            body: JSON.stringify({
              schedules: emails,
              startTime: { dateTime: start.toISOString(), timeZone: "UTC" },
              endTime: { dateTime: end.toISOString(), timeZone: "UTC" },
              availabilityViewInterval: 30,
            }),
          },
        );
        const out: Record<string, BusyBlock[]> = {};
        for (const s of res.value) {
          out[s.scheduleId] = s.scheduleItems
            .filter((i) => i.status !== "free")
            .map((i) => ({
              start: new Date(i.start.dateTime + "Z"),
              end: new Date(i.end.dateTime + "Z"),
              status: i.status === "tentative" ? "tentative" : i.status === "oof" ? "oof" : "busy",
            }));
        }
        return out;
      });
    },
    createEvent(input) {
      return logged("calendar", "createEvent", input.attendees.map((a) => a.email), async () => {
        const ev = await graph<{ id: string; webLink: string; onlineMeeting?: { joinUrl: string } }>(
          `/users/${encodeURIComponent(input.organizer)}/events`,
          {
            method: "POST",
            body: JSON.stringify({
              subject: input.subject,
              body: { contentType: "Text", content: input.body ?? "" },
              start: { dateTime: input.start.toISOString(), timeZone: "UTC" },
              end: { dateTime: input.end.toISOString(), timeZone: "UTC" },
              location: input.location ? { displayName: input.location } : undefined,
              attendees: input.attendees.map((a) => ({
                emailAddress: { address: a.email, name: a.name },
                type: a.optional ? "optional" : "required",
              })),
              isOnlineMeeting: !!input.teamsMeeting,
              onlineMeetingProvider: input.teamsMeeting ? "teamsForBusiness" : undefined,
            }),
          },
        );
        return { eventId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null, webLink: ev.webLink };
      }, (r) => ({ eventId: r.eventId }));
    },
    async cancelEvent(organizer, eventId, comment) {
      await logged("calendar", "cancelEvent", [organizer], () =>
        graph(`/users/${encodeURIComponent(organizer)}/events/${eventId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ comment: comment ?? "" }),
        }),
        () => ({ eventId }),
      );
    },
  },
  teams: {
    async notify(n) {
      // Requires the PATS Teams app installed for the user (see docs/INTEGRATIONS.md).
      await logged("teams", "sendActivityNotification", [n.toEmail], () =>
        graph(`/users/${encodeURIComponent(n.toEmail)}/teamwork/sendActivityNotification`, {
          method: "POST",
          body: JSON.stringify({
            topic: { source: "text", value: n.title, webUrl: n.url ?? process.env.APP_URL ?? "https://pats.purpose.ca" },
            activityType: "patsNotification",
            previewText: { content: n.text },
            templateParameters: [{ name: "title", value: n.title }],
          }),
        }),
      );
    },
  },
};
