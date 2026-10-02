import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { recordIntegrationEvent } from "@/server/integrations/m365/record";

/**
 * The PATS Teams bot's connection to the Bot Framework (ARCHITECTURE.md D7 sits beside this: Graph
 * goes through m365(); bot messages go through teamsBot()). Live when TEAMS_BOT_APP_ID and
 * TEAMS_BOT_APP_SECRET are set (an Azure Bot registration, single-tenant, Canada region), otherwise
 * mock. Cards and conversation ids are logged without card content (§4.6).
 */
export type ConversationRef = { conversationId: string; serviceUrl: string };
export type AdaptiveCard = Record<string, unknown>;

export interface TeamsBot {
  mode: "mock" | "live";
  sendCard(conv: ConversationRef, card: AdaptiveCard, summary: string): Promise<{ activityId: string }>;
  updateCard(conv: ConversationRef, activityId: string, card: AdaptiveCard): Promise<void>;
}

export const botAppId = () => process.env.TEAMS_BOT_APP_ID ?? "";
export const botConfigured = () => !!(process.env.TEAMS_BOT_APP_ID && process.env.TEAMS_BOT_APP_SECRET);

/** Only Microsoft's Bot Connector hosts; a stored serviceUrl can't point PATS anywhere else. */
export function trustedServiceUrl(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (/\.botframework\.com$/.test(u.hostname) || /(^|\.)trafficmanager\.net$/.test(u.hostname) || /\.teams\.microsoft\.com$/.test(u.hostname));
  } catch {
    return false;
  }
}

let tokenCache: { token: string; exp: number } | null = null;
async function botToken() {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.token;
  const tenant = process.env.TEAMS_BOT_TENANT_ID || process.env.M365_TENANT_ID || "botframework.com";
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: botAppId(), client_secret: process.env.TEAMS_BOT_APP_SECRET!, scope: "https://api.botframework.com/.default" }),
  });
  if (!res.ok) throw new Error(`Bot token request failed: ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return tokenCache.token;
}

async function connector<T>(conv: ConversationRef, path: string, init: RequestInit): Promise<T> {
  if (!trustedServiceUrl(conv.serviceUrl)) throw new Error("Untrusted Bot Connector serviceUrl.");
  const url = `${conv.serviceUrl.replace(/\/$/, "")}/v3/conversations/${encodeURIComponent(conv.conversationId)}/activities${path}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${await botToken()}`, "Content-Type": "application/json" } });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const ra = Number(res.headers.get("retry-after"));
      await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? Math.min(ra, 30) * 1000 : 2 ** attempt * 500));
      continue;
    }
    if (!res.ok) throw new Error(`Bot Connector ${init.method} failed: ${res.status}`);
    return (await res.json().catch(() => ({}))) as T;
  }
}

const cardActivity = (card: AdaptiveCard, summary?: string) => ({
  type: "message",
  summary,
  attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", content: card }],
});

const liveBot: TeamsBot = {
  mode: "live",
  async sendCard(conv, card, summary) {
    try {
      const r = await connector<{ id: string }>(conv, "", { method: "POST", body: JSON.stringify(cardActivity(card, summary)) });
      await recordIntegrationEvent({ service: "teams", operation: "bot.sendCard", mode: "live", ids: { activityId: r.id } });
      return { activityId: r.id };
    } catch (error) {
      await recordIntegrationEvent({ service: "teams", operation: "bot.sendCard", mode: "live", success: false, error });
      throw error;
    }
  },
  async updateCard(conv, activityId, card) {
    await connector(conv, `/${encodeURIComponent(activityId)}`, { method: "PUT", body: JSON.stringify({ ...cardActivity(card), id: activityId }) });
    await recordIntegrationEvent({ service: "teams", operation: "bot.updateCard", mode: "live", ids: { activityId } });
  },
};

const mockBot: TeamsBot = {
  mode: "mock",
  async sendCard() {
    const activityId = `mock-act-${Math.random().toString(36).slice(2, 10)}`;
    await recordIntegrationEvent({ service: "teams", operation: "bot.sendCard", mode: "mock", ids: { activityId } });
    return { activityId };
  },
  async updateCard(_conv, activityId) {
    await recordIntegrationEvent({ service: "teams", operation: "bot.updateCard", mode: "mock", ids: { activityId } });
  },
};

export function teamsBot(): TeamsBot {
  return botConfigured() ? liveBot : mockBot;
}

// ---------------------------------------------------------------------------
// Inbound: verify that a request really comes from the Bot Framework
// ---------------------------------------------------------------------------

let botJwks: JWTVerifyGetKey | null = null;
const defaultJwks = () => (botJwks ??= createRemoteJWKSet(new URL("https://login.botframework.com/v1/.well-known/keys")));

export class BotAuthError extends Error {
  constructor() {
    super("Unauthorized");
    this.name = "BotAuthError";
  }
}

/**
 * Bot Framework → bot authentication: a JWT signed by the Bot Framework, issued by
 * https://api.botframework.com, for this bot's app id, whose serviceUrl claim matches the activity.
 */
export async function verifyBotRequest(authHeader: string | null, activityServiceUrl: string | undefined, jwks: JWTVerifyGetKey = defaultJwks()) {
  if (!botAppId() || !authHeader?.startsWith("Bearer ")) throw new BotAuthError();
  try {
    const { payload } = await jwtVerify(authHeader.slice(7), jwks, { issuer: "https://api.botframework.com", audience: botAppId(), clockTolerance: 300 });
    if (payload.serviceurl && activityServiceUrl && String(payload.serviceurl).replace(/\/$/, "") !== activityServiceUrl.replace(/\/$/, "")) throw new BotAuthError();
    return payload;
  } catch {
    throw new BotAuthError();
  }
}
