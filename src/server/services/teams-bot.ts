import "server-only";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { teamsBot, trustedServiceUrl, type AdaptiveCard } from "@/server/integrations/teams";
import { ForbiddenError, NotFoundError, systemActor, userActor, type UserActor } from "@/server/policy";
import { money } from "@/lib/utils";
import { approvalInbox, approvalSummaryFor, type InboxItem } from "./approval-inbox";
import { decideApproval } from "./approval-decisions";
import { recordAudit } from "./audit";

/**
 * The PATS Teams app (PRD §6): approvers get an Adaptive Card in their PATS chat and can approve or
 * reject without leaving Teams. Decisions go through the same service as the web inbox, as the
 * Teams user mapped to their PATS account by Entra object id, so the same "is it your turn" check,
 * audit trail and outcome apply. Card content follows the approver-summary rule and hides pay from
 * roles that can't see it.
 */

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

type Activity = {
  type?: string;
  name?: string;
  serviceUrl?: string;
  from?: { id?: string; aadObjectId?: string };
  recipient?: { id?: string };
  conversation?: { id?: string; conversationType?: string; tenantId?: string };
  channelData?: { tenant?: { id?: string } };
  membersAdded?: { id?: string }[];
  action?: string;
  value?: { action?: { verb?: string; data?: Record<string, unknown> }; comment?: string } & Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

const text = (t: string, extra: Record<string, unknown> = {}) => ({ type: "TextBlock", text: t, wrap: true, ...extra });

function facts(item: InboxItem) {
  const f: { title: string; value: string }[] = [];
  if (item.offer) f.push({ title: "Candidate", value: item.offer.candidateName });
  f.push({ title: "Job", value: item.job.title });
  f.push({ title: "Brand", value: [item.job.brand, item.job.department].filter(Boolean).join(" · ") });
  if (item.offer?.baseSalary != null) f.push({ title: "Base", value: money(item.offer.baseSalary, item.offer.currency) });
  if (item.offer?.bonusPercent != null) f.push({ title: "Bonus", value: `${item.offer.bonusPercent}%` });
  if (item.job.compMin != null || item.job.compMax != null) f.push({ title: "Band", value: `${money(item.job.compMin, item.job.currency)} – ${money(item.job.compMax, item.job.currency)}` });
  if (item.offer?.startDate) f.push({ title: "Start", value: item.offer.startDate });
  if (!item.offer) f.push({ title: "Openings", value: String(item.job.openings) });
  if (item.requestedBy) f.push({ title: "Requested by", value: item.requestedBy });
  return f;
}

function progress(item: InboxItem) {
  return item.steps
    .map((st) => `${st.status === "approved" ? "✔" : st.status === "rejected" ? "✖" : st.status === "skipped" ? "–" : "○"} ${st.approver.name}`)
    .join("   ");
}

/** The card for one approval, from the approver's point of view. */
export function approvalCard(item: InboxItem, viewerAadId: string | null): AdaptiveCard {
  const kind = item.subject === "offer" ? "Offer" : "Job";
  const link = item.subject === "offer" ? `${appUrl()}/approvals` : `${appUrl()}/jobs/${item.job.id}`;
  const body: unknown[] = [
    text(`${kind} approval`, { size: "Small", isSubtle: true, weight: "Bolder" }),
    text(item.offer ? `${item.offer.candidateName} · ${item.job.title}` : item.job.title, { size: "Large", weight: "Bolder" }),
    { type: "FactSet", facts: facts(item) },
    text(progress(item), { size: "Small", isSubtle: true, spacing: "Medium" }),
  ];
  const actions: unknown[] = [];
  if (item.yourTurn) {
    body.push({ type: "Input.Text", id: "comment", placeholder: "Comment (required to reject)", isMultiline: true, maxLength: 2000 });
    actions.push(
      { type: "Action.Execute", title: "Approve", verb: "approval.approve", style: "positive", data: { requestId: item.requestId } },
      { type: "Action.Execute", title: "Reject", verb: "approval.reject", style: "destructive", data: { requestId: item.requestId } },
    );
  } else {
    body.push(
      text(
        item.status === "pending" ? "Waiting on someone else now." : item.status === "approved" ? "Approved." : item.status === "rejected" ? "Not approved." : "This request was cancelled.",
        { weight: "Bolder", spacing: "Medium", color: item.status === "approved" ? "Good" : item.status === "rejected" ? "Attention" : "Default" },
      ),
    );
  }
  actions.push({ type: "Action.OpenUrl", title: "Open in PATS", url: link });
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    // Teams refreshes the card for the approver when they open the chat, so it never shows stale buttons.
    refresh: viewerAadId ? { action: { type: "Action.Execute", verb: "approval.refresh", data: { requestId: item.requestId } }, userIds: [viewerAadId] } : undefined,
    body,
    actions,
  };
}

export function messageCard(message: string, link?: string): AdaptiveCard {
  return {
    type: "AdaptiveCard",
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    version: "1.5",
    body: [text(message, { wrap: true })],
    actions: link ? [{ type: "Action.OpenUrl", title: "Open PATS", url: link }] : [],
  };
}

// ---------------------------------------------------------------------------
// Outbound: cards to approvers
// ---------------------------------------------------------------------------

async function conversationFor(userId: string) {
  return db.query.teamsConversations.findFirst({ where: eq(s.teamsConversations.userId, userId) });
}

function itemFor(approver: UserActor, requestId: string) {
  return approvalSummaryFor(approver, requestId);
}

/**
 * Sends an approval card for each step now waiting on this person that hasn't had one. No-op if
 * they haven't installed the PATS Teams app. Call after the transaction commits.
 */
export async function sendApprovalCards(approverId: string) {
  const u = await db.query.users.findFirst({ where: eq(s.users.id, approverId) });
  const conv = u?.active ? await conversationFor(u.id) : null;
  if (!u || !conv) return 0;
  const approver = userActor(u);
  const { waiting } = await approvalInbox(approver);
  let sent = 0;
  for (const item of waiting) {
    const step = item.steps.find((st) => st.status === "pending");
    if (!step || step.approverId !== u.id) continue;
    if (await db.query.teamsCardMessages.findFirst({ where: eq(s.teamsCardMessages.stepId, step.id) })) continue;
    const { activityId } = await teamsBot().sendCard(conv, approvalCard(item, conv.aadObjectId), `${item.subject === "offer" ? "Offer" : "Job"} approval needed`);
    await db.insert(s.teamsCardMessages).values({ stepId: step.id, userId: u.id, activityId }).onConflictDoNothing();
    sent++;
  }
  return sent;
}

/** After a decision anywhere, cards for that request lose their buttons. Best effort. */
export async function refreshRequestCards(requestId: string) {
  const steps = await db.query.approvalSteps.findMany({ where: eq(s.approvalSteps.requestId, requestId) });
  for (const st of steps) {
    const msg = await db.query.teamsCardMessages.findFirst({ where: eq(s.teamsCardMessages.stepId, st.id) });
    if (!msg) continue;
    const [u, conv] = await Promise.all([db.query.users.findFirst({ where: eq(s.users.id, msg.userId) }), conversationFor(msg.userId)]);
    if (!u || !conv) continue;
    const item = await itemFor(userActor(u), requestId);
    if (!item) continue;
    await teamsBot().updateCard(conv, msg.activityId, approvalCard(item, conv.aadObjectId));
    await db.update(s.teamsCardMessages).set({ updatedAt: new Date() }).where(eq(s.teamsCardMessages.stepId, st.id));
  }
}

// ---------------------------------------------------------------------------
// Inbound: activities from Teams
// ---------------------------------------------------------------------------

export type BotResponse = { status: number; body?: unknown };

async function userForActivity(a: Activity) {
  const oid = a.from?.aadObjectId;
  if (!oid) return null;
  const u = await db.query.users.findFirst({ where: eq(s.users.entraObjectId, oid) });
  return u?.active ? u : null;
}

const cardResponse = (card: AdaptiveCard): BotResponse => ({ status: 200, body: { statusCode: 200, type: "application/vnd.microsoft.card.adaptive", value: card } });

/** Handles one verified activity. Returns what the HTTP response should carry. */
export async function handleBotActivity(a: Activity): Promise<BotResponse> {
  // Install / first contact in a personal chat: remember where to send cards.
  if ((a.type === "installationUpdate" && a.action !== "remove") || a.type === "conversationUpdate" || a.type === "message") {
    const u = await userForActivity(a);
    if (u && a.conversation?.id && a.conversation.conversationType !== "channel" && a.serviceUrl && trustedServiceUrl(a.serviceUrl)) {
      const values = { userId: u.id, aadObjectId: a.from!.aadObjectId!, conversationId: a.conversation.id, serviceUrl: a.serviceUrl, tenantId: a.conversation.tenantId ?? a.channelData?.tenant?.id ?? null, updatedAt: new Date() };
      const existed = await db.query.teamsConversations.findFirst({ where: eq(s.teamsConversations.userId, u.id) });
      await db.insert(s.teamsConversations).values(values).onConflictDoUpdate({ target: s.teamsConversations.userId, set: values });
      if (!existed) {
        await db.transaction((tx) => recordAudit(tx, systemActor("teams_bot"), "teams.installed", "user", u.id, {}));
        await sendApprovalCards(u.id);
      }
    }
    if (a.type === "message") {
      await teamsBot()
        .sendCard(
          { conversationId: a.conversation!.id!, serviceUrl: a.serviceUrl! },
          messageCard(u ? "Hi! PATS will send you approvals and updates here. Everything else lives in PATS." : "Sign in to PATS with your Purpose Microsoft account first, then come back here.", `${appUrl()}/approvals`),
          "PATS",
        )
        .catch(() => {});
    }
    return { status: 200 };
  }

  if (a.type === "invoke" && a.name === "adaptiveCard/action") {
    const verb = a.value?.action?.verb;
    const requestId = String(a.value?.action?.data?.requestId ?? "");
    const u = await userForActivity(a);
    if (!u) return cardResponse(messageCard("Sign in to PATS with your Purpose Microsoft account first.", `${appUrl()}/login`));
    const actor = userActor(u);
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return cardResponse(messageCard("That approval couldn't be found."));
    if (verb === "approval.approve" || verb === "approval.reject") {
      const comment = typeof a.value?.action?.data?.comment === "string" ? a.value.action.data.comment : typeof a.value?.comment === "string" ? a.value.comment : undefined;
      try {
        await decideApproval(actor, { requestId, decision: verb === "approval.approve" ? "approved" : "rejected", comment: comment?.trim() || undefined });
      } catch (e) {
        if (e instanceof ForbiddenError || e instanceof NotFoundError) {
          const item = await itemFor(actor, requestId);
          return cardResponse(item ? approvalCard(item, a.from!.aadObjectId!) : messageCard("This approval isn't waiting on you any more."));
        }
        const m = (e as Error).message;
        if (/comment/i.test(m)) {
          const item = await itemFor(actor, requestId);
          const card = item ? approvalCard(item, a.from!.aadObjectId!) : messageCard(m);
          (card.body as unknown[]).unshift(text("Add a comment explaining the rejection.", { color: "Attention", weight: "Bolder" }));
          return cardResponse(card);
        }
        if (/no longer pending|already decided/i.test(m)) return cardResponse(messageCard("This approval was already decided."));
        throw e;
      }
    }
    if (verb === "approval.approve" || verb === "approval.reject" || verb === "approval.refresh") {
      const item = await itemFor(actor, requestId);
      return cardResponse(item ? approvalCard(item, a.from!.aadObjectId!) : messageCard("This approval isn't available to you."));
    }
    return cardResponse(messageCard("PATS didn't recognise that action."));
  }

  return { status: 200 };
}

/** Removes a user's Teams conversation (e.g. app uninstalled). */
export async function forgetConversation(aadObjectId: string) {
  await db.delete(s.teamsConversations).where(and(eq(s.teamsConversations.aadObjectId, aadObjectId)));
}
