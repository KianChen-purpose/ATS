import type { NextRequest } from "next/server";
import { clientIp } from "@/server/security/request";
import { rateLimit, RateLimitError } from "@/server/security/rate-limit";
import { authenticateFeedToken, FeedAuthError, FeedQueryError, metadataDocument, readEntitySet, serviceDocument } from "@/server/services/reports/feed";

/**
 * OData v4 feed for Power BI and Excel ("Get data → OData feed"). Authenticate with a PATS feed
 * token as a Bearer token, or as the password with Basic auth (any user name), which is what the
 * Power BI connector sends. Read-only; see services/reports/feed.ts for what it exposes.
 */
const ODATA_HEADERS = { "OData-Version": "4.0", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const FEED_LIMIT = { limit: 300, windowMs: 60_000 };
const AUTH_FAIL_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

function presentedToken(req: NextRequest) {
  const h = req.headers.get("authorization") ?? "";
  if (h.startsWith("Bearer ")) return h.slice(7).trim();
  if (h.startsWith("Basic ")) {
    const decoded = Buffer.from(h.slice(6), "base64").toString("utf8");
    return decoded.slice(decoded.indexOf(":") + 1);
  }
  return null;
}

function odataError(status: number, message: string, extra: Record<string, string> = {}) {
  return Response.json({ error: { code: String(status), message } }, { status, headers: { ...ODATA_HEADERS, ...extra } });
}

export async function GET(req: NextRequest, ctx: RouteContext<"/api/odata/[[...path]]">) {
  const ip = await clientIp();
  const token = presentedToken(req);
  let session;
  try {
    if (!token) throw new FeedAuthError();
    session = await authenticateFeedToken(token, { requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(), ip, userAgent: req.headers.get("user-agent") });
    rateLimit(`feed:${session.tokenId}`, FEED_LIMIT);
  } catch (e) {
    if (e instanceof RateLimitError) return odataError(429, e.message, { "Retry-After": "60" });
    if (e instanceof FeedAuthError) {
      try {
        rateLimit(`feed-auth:${ip}`, AUTH_FAIL_LIMIT);
      } catch {
        return odataError(429, "Too many failed attempts.", { "Retry-After": "600" });
      }
      return odataError(401, e.message, { "WWW-Authenticate": 'Basic realm="PATS reporting feed", charset="UTF-8"' });
    }
    throw e;
  }

  const base = `${req.nextUrl.origin}/api/odata`;
  const path = (await ctx.params).path ?? [];
  const { actor, tokenId } = session;

  if (path.length === 0) return Response.json(serviceDocument(actor, base), { headers: { ...ODATA_HEADERS, "Content-Type": "application/json;odata.metadata=minimal" } });
  if (path.length === 1 && path[0] === "$metadata") return new Response(metadataDocument(actor), { headers: { ...ODATA_HEADERS, "Content-Type": "application/xml" } });
  if (path.length !== 1) return odataError(404, "Not found.");

  const query = Object.fromEntries(req.nextUrl.searchParams);
  try {
    const page = await readEntitySet(actor, tokenId, path[0], query);
    const body: Record<string, unknown> = { "@odata.context": `${base}/$metadata#${path[0]}` };
    if (page.count != null) body["@odata.count"] = page.count;
    body.value = page.rows;
    if (page.next) {
      const next = new URLSearchParams(query);
      next.set("$skip", String(page.next.skip));
      if (page.next.top != null) next.set("$top", String(page.next.top));
      body["@odata.nextLink"] = `${base}/${encodeURIComponent(path[0])}?${next.toString()}`;
    }
    return Response.json(body, { headers: { ...ODATA_HEADERS, "Content-Type": "application/json;odata.metadata=minimal" } });
  } catch (e) {
    if (e instanceof FeedQueryError) return odataError(e.status, e.message);
    throw e;
  }
}
