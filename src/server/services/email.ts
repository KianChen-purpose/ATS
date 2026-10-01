import "server-only";
import { db, schema as s } from "@/db";
import { actorUserId, type Actor } from "@/server/policy";
import { m365 } from "@/server/integrations/m365";
import { recordAudit } from "./audit";

/**
 * Send a candidate email through M365 and record it on the candidate's Emails tab (+ timeline).
 * Internal: callers must already have authorized the actor for the candidate/application.
 */
export async function sendAndLogEmail(
  actor: Actor,
  opts: {
    candidateId: string;
    applicationId: string | null;
    from: string;
    to: string;
    subject: string;
    body: string;
    timeline?: boolean;
    auditAction?: string;
  },
) {
  const sent = await m365().mail.send({ from: opts.from, to: opts.to, subject: opts.subject, body: opts.body });
  await db.transaction(async (tx) => {
    const [email] = await tx
      .insert(s.emails)
      .values({
        candidateId: opts.candidateId,
        direction: "outbound",
        fromAddress: opts.from,
        toAddress: opts.to,
        subject: opts.subject,
        body: opts.body,
        sentById: actorUserId(actor),
        externalMessageId: sent.messageId,
        externalThreadId: sent.threadId,
      })
      .returning({ id: s.emails.id });
    if (opts.timeline !== false) {
      await tx.insert(s.activities).values({
        candidateId: opts.candidateId,
        applicationId: opts.applicationId,
        type: "email",
        actorId: actorUserId(actor),
        body: `Emailed: ${opts.subject}`,
      });
    }
    await recordAudit(tx, actor, opts.auditAction ?? "email.sent", "email", email.id, { candidateId: opts.candidateId, applicationId: opts.applicationId });
  });
  return sent;
}
