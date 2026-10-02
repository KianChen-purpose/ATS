import { and, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { db, schema } from "@/db";
import { recordIntegrationEvent } from "./record";
import type { BusyBlock, M365Client } from "./types";

const rid = (prefix: string) => `${prefix}${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

/** Simple deterministic hash so each person gets a stable, realistic-looking calendar. */
function hash(str: string) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Mock M365: behaves like Graph (ids, Teams join links, free/busy) without a tenant.
 * Busy time = the person's real PATS interviews + a stable pseudo-random set of meetings.
 */
export const mockM365: M365Client = {
  mode: "mock",
  mail: {
    async send(input) {
      const res = { messageId: rid("AAMkMsg"), threadId: rid("AAQkConv") };
      await recordIntegrationEvent({
        service: "mail",
        operation: "sendMail",
        mode: "mock",
        recipients: [input.to, ...(input.cc ?? [])],
        ids: res,
      });
      return res;
    },
  },
  calendar: {
    async getSchedule(emails, start, end) {
      const users = await db.query.users.findMany({ where: inArray(schema.users.email, emails) });
      const byId = new Map(users.map((u) => [u.id, u.email]));
      const result: Record<string, BusyBlock[]> = Object.fromEntries(emails.map((e) => [e, []]));

      if (users.length) {
        const rows = await db
          .select({ start: schema.interviews.startAt, end: schema.interviews.endAt, userId: schema.interviewInterviewers.userId })
          .from(schema.interviews)
          .innerJoin(schema.interviewInterviewers, eq(schema.interviewInterviewers.interviewId, schema.interviews.id))
          .where(
            and(
              inArray(schema.interviewInterviewers.userId, users.map((u) => u.id)),
              gte(schema.interviews.endAt, start),
              lte(schema.interviews.startAt, end),
              ne(schema.interviews.status, "cancelled"),
            ),
          );
        for (const r of rows) result[byId.get(r.userId)!]?.push({ start: r.start, end: r.end, status: "busy" });
      }

      // Synthetic meetings: weekdays 9:00–17:00 Toronto (13:00–21:00 UTC), ~3 per day per person.
      for (const email of emails) {
        for (let d = new Date(start); d < end; d = new Date(d.getTime() + 86_400_000)) {
          const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
          const seed = hash(email + day.toISOString().slice(0, 10));
          for (let k = 0; k < 3; k++) {
            const slot = (seed >> (k * 4)) % 16; // 16 half-hour slots
            if ((seed >> (k + 20)) % 3 === 0) continue;
            const s = new Date(day.getTime() + (13 * 60 + slot * 30) * 60_000);
            const len = ((seed >> (k + 12)) % 2) + 1;
            result[email].push({ start: s, end: new Date(s.getTime() + len * 30 * 60_000), status: "busy" });
          }
          // Lunch block
          result[email].push({ start: new Date(day.getTime() + 16 * 3_600_000), end: new Date(day.getTime() + 17 * 3_600_000), status: "tentative" });
        }
      }

      await recordIntegrationEvent({
        service: "calendar",
        operation: "getSchedule",
        mode: "mock",
        recipients: emails,
      });
      return result;
    },
    async createEvent(input) {
      const res = {
        eventId: rid("AAMkEvt"),
        joinUrl: input.teamsMeeting ? `https://teams.microsoft.com/l/meetup-join/${rid("19%3ameeting_")}` : null,
        webLink: `https://outlook.office365.com/owa/?itemid=${rid("")}`,
      };
      await recordIntegrationEvent({
        service: "calendar",
        operation: "createEvent",
        mode: "mock",
        recipients: input.attendees.map((a) => a.email),
        counts: { teamsMeeting: input.teamsMeeting ? 1 : 0 },
        ids: { eventId: res.eventId },
      });
      return res;
    },
    async cancelEvent(organizer, eventId) {
      await recordIntegrationEvent({
        service: "calendar",
        operation: "cancelEvent",
        mode: "mock",
        recipients: [organizer],
        ids: { eventId },
      });
    },
  },
  teams: {
    async notify(n) {
      await recordIntegrationEvent({
        service: "teams",
        operation: "sendActivityNotification",
        mode: "mock",
        recipients: [n.toEmail],
      });
    },
  },
};
