import type { NextRequest } from "next/server";
import { clientIp } from "@/server/security/request";
import { rateLimit, RateLimitError } from "@/server/security/rate-limit";
import { acceptNotifications } from "@/server/services/mail-sync";

/**
 * Microsoft Graph change notifications (mail). Graph first validates the URL by POSTing
 * ?validationToken=…, which must be echoed as text/plain. Real notifications are checked against
 * each subscription's clientState and turned into queue jobs; the response is immediate.
 */
export async function POST(req: NextRequest) {
  const validationToken = req.nextUrl.searchParams.get("validationToken");
  if (validationToken) return new Response(validationToken.slice(0, 1024), { status: 200, headers: { "Content-Type": "text/plain" } });
  try {
    rateLimit(`graph-notify:${await clientIp()}`, { limit: 600, windowMs: 60_000 });
  } catch (e) {
    if (e instanceof RateLimitError) return new Response(null, { status: 429, headers: { "Retry-After": "60" } });
    throw e;
  }
  const body = await req.json().catch(() => null);
  await acceptNotifications(body);
  return new Response(null, { status: 202 });
}
