import "server-only";
import { db, schema as s } from "@/db";
import { m365 } from "@/server/integrations/m365";

/** Send a candidate email through M365 and record it on the candidate's Emails tab (+ timeline). */
export async function sendAndLogEmail(opts: {
  candidateId: string;
  applicationId: string | null;
  from: string;
  to: string;
  subject: string;
  body: string;
  sentById: string | null;
  timeline?: boolean;
}) {
  const sent = await m365().mail.send({ from: opts.from, to: opts.to, subject: opts.subject, body: opts.body });
  await db.insert(s.emails).values({
    candidateId: opts.candidateId,
    direction: "outbound",
    fromAddress: opts.from,
    toAddress: opts.to,
    subject: opts.subject,
    body: opts.body,
    sentById: opts.sentById,
    externalMessageId: sent.messageId,
    externalThreadId: sent.threadId,
  });
  if (opts.timeline !== false) {
    await db.insert(s.activities).values({
      candidateId: opts.candidateId,
      applicationId: opts.applicationId,
      type: "email",
      actorId: opts.sentById,
      body: `Emailed: ${opts.subject}`,
    });
  }
  return sent;
}
