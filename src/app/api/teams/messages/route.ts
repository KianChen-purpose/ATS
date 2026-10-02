import type { NextRequest } from "next/server";
import { BotAuthError, verifyBotRequest } from "@/server/integrations/teams";
import { handleBotActivity } from "@/server/services/teams-bot";

/**
 * Bot Framework messaging endpoint for the PATS Teams app. Every request must carry a Bot
 * Framework token for this bot (verified before anything is read from the activity).
 */
export async function POST(req: NextRequest) {
  const activity = await req.json().catch(() => null);
  if (!activity || typeof activity !== "object") return new Response(null, { status: 400 });
  try {
    await verifyBotRequest(req.headers.get("authorization"), (activity as { serviceUrl?: string }).serviceUrl);
  } catch (e) {
    if (e instanceof BotAuthError) return new Response(null, { status: 401 });
    throw e;
  }
  const res = await handleBotActivity(activity);
  return res.body ? Response.json(res.body, { status: res.status }) : new Response(null, { status: res.status });
}
