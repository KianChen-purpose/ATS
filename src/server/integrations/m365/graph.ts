import { delegatedToken } from "./delegated";
import { recordIntegrationEvent } from "./record";
import type { BusyBlock, M365Client, MailMessage } from "./types";

type GraphMessage = {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  body?: { content?: string };
  "@removed"?: unknown;
};
const MESSAGE_SELECT = "id,internetMessageId,conversationId,subject,receivedDateTime,from,toRecipients,body";
const toMessage = (m: GraphMessage): MailMessage => ({
  id: m.id,
  internetMessageId: m.internetMessageId ?? m.id,
  conversationId: m.conversationId ?? "",
  from: (m.from?.emailAddress?.address ?? "").toLowerCase(),
  to: (m.toRecipients ?? []).map((r) => (r.emailAddress?.address ?? "").toLowerCase()).filter(Boolean),
  subject: m.subject ?? "",
  bodyText: m.body?.content ?? "",
  receivedAt: new Date(m.receivedDateTime ?? Date.now()),
});

/**
 * Live Microsoft Graph client (ARCHITECTURE.md §8.1):
 * - As the user (delegated, from their Microsoft sign-in): mail from their mailbox, events on their
 *   calendar. Delegated permissions: Mail.Send, Calendars.ReadWrite, User.Read.
 * - As the app (client credentials), only for the shared mailbox (M365_SENDER_MAILBOX, e.g.
 *   careers@) and background work: Mail.Send, Mail.Read and Calendars.Read on that mailbox (scoped
 *   with an Exchange Application Access Policy / RBAC for Applications) and TeamsActivity.Send.
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

export class GraphError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "GraphError";
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Graph request that honours 429/503 Retry-After with exponential backoff (ARCHITECTURE.md §8.3). */
const shared = () => (process.env.M365_SENDER_MAILBOX ?? "").toLowerCase();

/** App token for the shared mailbox and app-level calls; the user's delegated token for their own mailbox. */
function tokenFor(mailbox: string | "app") {
  return mailbox === "app" || mailbox.toLowerCase() === shared() ? token() : delegatedToken(mailbox);
}

async function graph<T>(path: string, init: RequestInit = {}, as: string | "app" = "app"): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(path.startsWith("https://") ? path : `${GRAPH}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${await tokenFor(as)}`, "Content-Type": "application/json", ...init.headers },
    });
    if ((res.status === 429 || res.status === 503) && attempt < MAX_ATTEMPTS) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 2 ** attempt * 500);
      continue;
    }
    if (!res.ok) throw new GraphError(res.status, `Graph ${init.method ?? "GET"} ${path.replace(GRAPH, "").split("/")[1]} failed: ${res.status} ${await res.text()}`);
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
        }, input.from);
        await graph(`/users/${encodeURIComponent(input.from)}/messages/${draft.id}/send`, { method: "POST" }, input.from);
        return { messageId: draft.id, threadId: draft.conversationId };
      }, (r) => r);
    },
    async getMessage(mailbox, id) {
      try {
        const m = await graph<GraphMessage>(`/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(id)}?$select=${MESSAGE_SELECT}`, { headers: { Prefer: 'outlook.body-content-type="text"' } }, mailbox);
        await recordIntegrationEvent({ service: "mail", operation: "messages.get", mode: "live", ids: { messageId: id } });
        return toMessage(m);
      } catch (e) {
        if (e instanceof GraphError && e.status === 404) return null;
        await recordIntegrationEvent({ service: "mail", operation: "messages.get", mode: "live", success: false, error: e });
        throw e;
      }
    },
    delta(mailbox, deltaLink, since) {
      return logged("mail", "messages.delta", [], async () => {
        let url =
          deltaLink ??
          `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages/delta?$select=${MESSAGE_SELECT}&$filter=${encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`)}`;
        const messages: MailMessage[] = [];
        for (let pages = 0; pages < 50; pages++) {
          const page = await graph<{ value: GraphMessage[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string }>(url, { headers: { Prefer: 'outlook.body-content-type="text", odata.maxpagesize=50' } }, mailbox);
          messages.push(...page.value.filter((m) => !m["@removed"]).map(toMessage));
          if (page["@odata.deltaLink"]) return { messages, deltaLink: page["@odata.deltaLink"] };
          if (!page["@odata.nextLink"]) break;
          url = page["@odata.nextLink"];
        }
        return { messages, deltaLink: url };
      });
    },
  },
  subscriptions: {
    createMail(input) {
      return logged("mail", "subscriptions.create", [], async () => {
        const sub = await graph<{ id: string; expirationDateTime: string }>(
          "/subscriptions",
          {
            method: "POST",
            body: JSON.stringify({
              changeType: "created",
              notificationUrl: input.notificationUrl,
              lifecycleNotificationUrl: input.lifecycleNotificationUrl,
              resource: `users/${input.mailbox}/mailFolders('Inbox')/messages`,
              expirationDateTime: input.expiresAt.toISOString(),
              clientState: input.clientState,
            }),
          },
          input.mailbox,
        );
        return { id: sub.id, expiresAt: new Date(sub.expirationDateTime) };
      }, (r) => ({ subscriptionId: r.id }));
    },
    renew(mailbox, id, expiresAt) {
      return logged("mail", "subscriptions.renew", [], async () => {
        const sub = await graph<{ expirationDateTime: string }>(`/subscriptions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ expirationDateTime: expiresAt.toISOString() }) }, mailbox);
        return { expiresAt: new Date(sub.expirationDateTime) };
      }, () => ({ subscriptionId: id }));
    },
    async remove(mailbox, id) {
      await logged("mail", "subscriptions.delete", [], async () => {
        try {
          await graph(`/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }, mailbox);
        } catch (e) {
          if (!(e instanceof GraphError && e.status === 404)) throw e;
        }
      }, () => ({ subscriptionId: id }));
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
          input.organizer,
        );
        return { eventId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null, webLink: ev.webLink };
      }, (r) => ({ eventId: r.eventId }));
    },
    async cancelEvent(organizer, eventId, comment) {
      await logged("calendar", "cancelEvent", [organizer], () =>
        graph(`/users/${encodeURIComponent(organizer)}/events/${eventId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ comment: comment ?? "" }),
        }, organizer),
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
