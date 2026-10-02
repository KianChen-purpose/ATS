import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";

/**
 * Delegated Graph access tokens (ARCHITECTURE.md §8.1): when PATS sends mail or creates events as
 * a user, it uses that user's own consent from Microsoft sign-in, never tenant-wide app access to
 * their mailbox. Access tokens are cached in memory; rotated refresh tokens are re-encrypted.
 */
const GRAPH_SCOPES = "https://graph.microsoft.com/Mail.Send https://graph.microsoft.com/Calendars.ReadWrite offline_access";
const cache = new Map<string, { token: string; exp: number }>();

export class DelegatedConsentMissing extends Error {
  constructor(mailbox: string) {
    super(`${mailbox.split("@")[0]} needs to sign in to PATS with Microsoft before PATS can send from their mailbox.`);
    this.name = "DelegatedConsentMissing";
  }
}

export async function delegatedToken(mailbox: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const user = await db.query.users.findFirst({ where: sql`lower(${schema.users.email}) = ${mailbox.toLowerCase()}` });
  if (!user) throw new DelegatedConsentMissing(mailbox);
  const hit = cache.get(user.id);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const row = await db.query.userOauthTokens.findFirst({ where: eq(schema.userOauthTokens.userId, user.id) });
  if (!row) throw new DelegatedConsentMissing(mailbox);
  const res = await fetchImpl(`https://login.microsoftonline.com/${process.env.M365_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.M365_CLIENT_ID!,
      client_secret: process.env.M365_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: decryptSecret(row.refreshTokenEnc),
      scope: GRAPH_SCOPES,
    }),
  });
  if (!res.ok) {
    // Revoked or expired consent: forget it so the user is asked to sign in again.
    if (res.status === 400 || res.status === 401) await db.delete(schema.userOauthTokens).where(eq(schema.userOauthTokens.userId, user.id));
    throw new DelegatedConsentMissing(mailbox);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number; refresh_token?: string };
  cache.set(user.id, { token: json.access_token, exp: Date.now() + json.expires_in * 1000 });
  if (json.refresh_token) {
    await db.update(schema.userOauthTokens).set({ refreshTokenEnc: encryptSecret(json.refresh_token), updatedAt: new Date() }).where(eq(schema.userOauthTokens.userId, user.id));
  }
  return json.access_token;
}

/** Test hook. */
export function clearDelegatedCache() {
  cache.clear();
}
