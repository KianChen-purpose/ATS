import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from "jose";
import { db, schema as s } from "@/db";
import * as entra from "@/server/services/entra-auth";
import { decryptSecret, encryptSecret } from "@/server/security/crypto";
import { clearDelegatedCache, delegatedToken, DelegatedConsentMissing } from "@/server/integrations/m365/delegated";
import { makeUser, resetDb } from "./fixtures";

const TENANT = "11111111-2222-3333-4444-555555555555";
const CLIENT = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const saved = { ...process.env };
let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  Object.assign(process.env, { M365_TENANT_ID: TENANT, M365_CLIENT_ID: CLIENT, M365_CLIENT_SECRET: "secret", APP_URL: "https://pats.test", TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64") });
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey as CryptoKey;
  const jwk = (await exportJWK(kp.publicKey)) as JWK;
  jwks = createLocalJWKSet({ keys: [{ ...jwk, kid: "k1", alg: "RS256", use: "sig" }] });
});
afterAll(() => {
  for (const k of ["M365_TENANT_ID", "M365_CLIENT_ID", "M365_CLIENT_SECRET", "APP_URL", "TOKEN_ENCRYPTION_KEY", "ENTRA_ALLOW_JIT"]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function idToken(claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) {
  return new SignJWT({ tid: TENANT, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(opts.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`)
    .setAudience(opts.aud ?? CLIENT)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

/** Runs the whole flow: start, then a fake Entra token endpoint returning the given claims. */
async function signIn(claims: Record<string, unknown>, opts: { iss?: string; nonce?: string; state?: string; refresh?: string } = {}) {
  const start = await entra.startSignIn("/jobs");
  const url = new URL(start.url);
  const sent: URLSearchParams[] = [];
  const fakeFetch = (async (_u: string, init: RequestInit) => {
    sent.push(new URLSearchParams(String(init.body)));
    const token = await idToken({ nonce: opts.nonce ?? url.searchParams.get("nonce"), ...claims }, { iss: opts.iss });
    return new Response(JSON.stringify({ id_token: token, refresh_token: opts.refresh ?? "rt-1", scope: "Mail.Send" }), { status: 200 });
  }) as unknown as typeof fetch;
  const result = await entra.finishSignIn({ code: "code-1", state: opts.state ?? url.searchParams.get("state"), flowCookie: start.flowCookie }, entra.entraSettings(), { fetch: fakeFetch, jwks });
  return { result, sent, url };
}

describe("Entra ID sign-in", () => {
  beforeEach(async () => {
    await resetDb();
    delete process.env.ENTRA_ALLOW_JIT;
  });

  it("starts an authorization-code flow with PKCE, state and nonce", async () => {
    const { url } = await entra.startSignIn("/reports");
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe(`https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("redirect_uri")).toBe("https://pats.test/auth/callback");
    expect(u.searchParams.get("scope")).toContain("offline_access");
    expect(u.searchParams.get("state")!.length).toBeGreaterThan(20);
    expect(entra.safeNext("//evil.example")).toBe("/");
    expect(entra.safeNext("https://evil.example")).toBe("/");
    expect(entra.safeNext("/auth/callback")).toBe("/");
    expect(entra.safeNext("/jobs?x=1")).toBe("/jobs?x=1");
  });

  it("links a provisioned user by email, takes the role from app roles, stores the refresh token encrypted, and audits", async () => {
    const u = await makeUser("interviewer", "Rita Recruiter");
    const { result, sent } = await signIn({ oid: "oid-rita", email: u.email.toUpperCase(), name: "Rita", roles: ["PATS.Interviewer", "PATS.Recruiter"] });
    expect(result.next).toBe("/jobs");
    expect(result.user).toMatchObject({ id: u.id, role: "recruiter", entraObjectId: "oid-rita" });
    expect(sent[0].get("code_verifier")!.length).toBeGreaterThan(40);
    const tok = await db.query.userOauthTokens.findFirst({ where: eq(s.userOauthTokens.userId, u.id) });
    expect(tok!.refreshTokenEnc).not.toContain("rt-1");
    expect(decryptSecret(tok!.refreshTokenEnc)).toBe("rt-1");
    const actions = (await db.query.auditLogs.findMany({ where: eq(s.auditLogs.entityId, u.id) })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["user.entra_linked", "user.role_changed", "auth.signed_in"]));
    // Second sign-in matches by object id even if the email changed.
    const again = await signIn({ oid: "oid-rita", email: "renamed@purpose.test", roles: ["PATS.Recruiter"] });
    expect(again.result.user.id).toBe(u.id);
  });

  it("rejects mismatched state, nonce, issuer and tenant", async () => {
    await makeUser("recruiter");
    await expect(signIn({ oid: "x" }, { state: "forged" })).rejects.toMatchObject({ code: "state" });
    await expect(signIn({ oid: "x" }, { nonce: "replayed" })).rejects.toMatchObject({ code: "token" });
    await expect(signIn({ oid: "x" }, { iss: "https://login.microsoftonline.com/other-tenant/v2.0" })).rejects.toMatchObject({ code: "token" });
    await expect(signIn({ oid: "x", tid: "other-tenant" })).rejects.toMatchObject({ code: "token" });
    await expect(entra.finishSignIn({ code: "c", state: "s", flowCookie: "not-a-jwt" }, entra.entraSettings(), { fetch, jwks })).rejects.toMatchObject({ code: "state" });
  });

  it("refuses unprovisioned, deactivated and conflicting accounts; JIT only when enabled", async () => {
    await expect(signIn({ oid: "new", email: "new@purpose.test" })).rejects.toMatchObject({ code: "not_provisioned" });
    process.env.ENTRA_ALLOW_JIT = "true";
    const { result } = await signIn({ oid: "new", email: "new@purpose.test", name: "New Person" });
    expect(result.user).toMatchObject({ role: "interviewer", name: "New Person" });

    const off = await makeUser("recruiter");
    await db.update(s.users).set({ active: false }).where(eq(s.users.id, off.id));
    await expect(signIn({ oid: "off", email: off.email })).rejects.toMatchObject({ code: "inactive" });

    const linked = await makeUser("recruiter");
    await db.update(s.users).set({ entraObjectId: "someone-else" }).where(eq(s.users.id, linked.id));
    await expect(signIn({ oid: "imposter", email: linked.email })).rejects.toMatchObject({ code: "conflict" });
  });
});

describe("token encryption and delegated Graph tokens", () => {
  beforeEach(async () => {
    await resetDb();
    clearDelegatedCache();
  });

  it("encrypts with authentication: tampering fails", () => {
    const enc = encryptSecret("hello");
    expect(decryptSecret(enc)).toBe("hello");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("refreshes a user's delegated token, stores the rotated refresh token, and forgets revoked consent", async () => {
    const u = await makeUser("recruiter");
    await db.insert(s.userOauthTokens).values({ userId: u.id, refreshTokenEnc: encryptSecret("rt-old"), scopes: "Mail.Send" });
    let calls = 0;
    const ok = (async (_u: string, init: RequestInit) => {
      calls++;
      expect(new URLSearchParams(String(init.body)).get("refresh_token")).toBe("rt-old");
      return new Response(JSON.stringify({ access_token: "at-1", expires_in: 3600, refresh_token: "rt-new" }));
    }) as unknown as typeof fetch;
    expect(await delegatedToken(u.email, ok)).toBe("at-1");
    expect(await delegatedToken(u.email, ok)).toBe("at-1"); // cached
    expect(calls).toBe(1);
    const row = await db.query.userOauthTokens.findFirst({ where: eq(s.userOauthTokens.userId, u.id) });
    expect(decryptSecret(row!.refreshTokenEnc)).toBe("rt-new");

    clearDelegatedCache();
    const revoked = (async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(delegatedToken(u.email, revoked)).rejects.toBeInstanceOf(DelegatedConsentMissing);
    expect(await db.query.userOauthTokens.findFirst({ where: eq(s.userOauthTokens.userId, u.id) })).toBeUndefined();
    await expect(delegatedToken("nobody@purpose.test", ok)).rejects.toBeInstanceOf(DelegatedConsentMissing);
  });

  it("maps app roles with a fixed precedence", () => {
    expect(entra.roleFromClaims(["PATS.HiringManager", "PATS.Executive"])).toBe("executive");
    expect(entra.roleFromClaims(["Something.Else"])).toBeNull();
    expect(entra.roleFromClaims(undefined)).toBeNull();
  });
});
