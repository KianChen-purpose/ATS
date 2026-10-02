import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyGetKey } from "jose";
import { db, schema as s } from "@/db";
import { entraConfigured, sessionSecret } from "@/server/config";
import { userActor, type Role, type RequestContext } from "@/server/policy";
import { encryptSecret } from "@/server/security/crypto";
import { recordAudit } from "./audit";

/**
 * Staff sign-in with Microsoft Entra ID (ARCHITECTURE.md §6.1): OpenID Connect authorization code
 * flow with PKCE, state and nonce. MFA and device rules are enforced by Conditional Access in Entra,
 * not here. The same consent grants PATS delegated Graph access, so mail and calendar events go out
 * as the user (§8.1).
 */

export const ENTRA_SCOPES = ["openid", "profile", "email", "offline_access", "User.Read", "Mail.Send", "Calendars.ReadWrite"];
const FLOW_TTL_SECONDS = 600;

/** Entra app roles → PATS roles. Define these app roles on the app registration and assign groups to them. */
export const APP_ROLE_MAP: Record<string, Role> = {
  "PATS.Admin": "admin",
  "PATS.Recruiter": "recruiter",
  "PATS.Coordinator": "coordinator",
  "PATS.Executive": "executive",
  "PATS.HiringManager": "hiring_manager",
  "PATS.Interviewer": "interviewer",
};
/** When someone holds several roles, the first in this list wins. */
const ROLE_PRECEDENCE: Role[] = ["admin", "recruiter", "coordinator", "executive", "hiring_manager", "interviewer"];

export function roleFromClaims(roles: unknown): Role | null {
  if (!Array.isArray(roles)) return null;
  const mapped = new Set(roles.map((r) => APP_ROLE_MAP[String(r)]).filter(Boolean));
  return ROLE_PRECEDENCE.find((r) => mapped.has(r)) ?? null;
}

export class SignInError extends Error {
  constructor(
    public code: "config" | "state" | "token" | "not_provisioned" | "inactive" | "conflict",
    message: string,
  ) {
    super(message);
    this.name = "SignInError";
  }
}

export type EntraSettings = { tenantId: string; clientId: string; clientSecret: string; redirectUri: string; authority: string };

export function entraSettings(): EntraSettings {
  if (!entraConfigured()) throw new SignInError("config", "Microsoft sign-in isn't configured.");
  const tenantId = process.env.M365_TENANT_ID!;
  return {
    tenantId,
    clientId: process.env.M365_CLIENT_ID!,
    clientSecret: process.env.M365_CLIENT_SECRET!,
    redirectUri: `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/auth/callback`,
    authority: `https://login.microsoftonline.com/${tenantId}`,
  };
}

/** Injectable for tests: the token endpoint and the tenant's signing keys. */
export type EntraDeps = { fetch: typeof fetch; jwks: JWTVerifyGetKey };
const jwksCache = new Map<string, JWTVerifyGetKey>();
export function defaultDeps(cfg: EntraSettings): EntraDeps {
  let jwks = jwksCache.get(cfg.authority);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${cfg.authority}/discovery/v2.0/keys`));
    jwksCache.set(cfg.authority, jwks);
  }
  return { fetch, jwks };
}

const b64url = (b: Buffer) => b.toString("base64url");

/** Only same-site paths are allowed as the post-sign-in destination (no open redirect). */
export function safeNext(next: unknown) {
  return typeof next === "string" && /^\/(?!\/)[^\s\\]*$/.test(next) && !next.startsWith("/auth/") ? next : "/";
}

/**
 * Step 1: where to send the browser, plus a signed short-lived cookie that carries state, nonce and
 * the PKCE verifier back to the callback.
 */
export async function startSignIn(next: unknown, cfg = entraSettings()) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const flow = await new SignJWT({ state, nonce, verifier, next: safeNext(next) })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${FLOW_TTL_SECONDS}s`)
    .setAudience("pats:entra-flow")
    .sign(sessionSecret());
  const url = new URL(`${cfg.authority}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    response_mode: "query",
    scope: ENTRA_SCOPES.join(" "),
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), flowCookie: flow, maxAge: FLOW_TTL_SECONDS };
}

type IdClaims = { oid?: string; tid?: string; nonce?: string; preferred_username?: string; email?: string; name?: string; roles?: unknown };

/**
 * Step 2: verify the callback, redeem the code, verify the ID token and resolve the PATS user.
 * Users must already exist (provisioned by SCIM) unless ENTRA_ALLOW_JIT=true.
 */
export async function finishSignIn(
  input: { code: string | null; state: string | null; flowCookie: string | undefined; request?: RequestContext },
  cfg = entraSettings(),
  deps: EntraDeps = defaultDeps(cfg),
) {
  if (!input.code || !input.state || !input.flowCookie) throw new SignInError("state", "The sign-in link expired. Please try again.");
  let flow: { state: string; nonce: string; verifier: string; next: string };
  try {
    const { payload } = await jwtVerify(input.flowCookie, sessionSecret(), { audience: "pats:entra-flow" });
    flow = payload as typeof flow;
  } catch {
    throw new SignInError("state", "The sign-in link expired. Please try again.");
  }
  if (flow.state !== input.state) throw new SignInError("state", "The sign-in request didn't match. Please try again.");

  const res = await deps.fetch(`${cfg.authority}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: cfg.redirectUri,
      code_verifier: flow.verifier,
      scope: ENTRA_SCOPES.join(" "),
    }),
  });
  // Never echo the provider response: it can contain tokens.
  if (!res.ok) throw new SignInError("token", `Microsoft didn't accept the sign-in (${res.status}).`);
  const tokens = (await res.json()) as { id_token?: string; refresh_token?: string; scope?: string };
  if (!tokens.id_token) throw new SignInError("token", "Microsoft returned no ID token.");

  let claims: IdClaims;
  try {
    const { payload } = await jwtVerify(tokens.id_token, deps.jwks, {
      issuer: `https://login.microsoftonline.com/${cfg.tenantId}/v2.0`,
      audience: cfg.clientId,
      clockTolerance: 120,
    });
    claims = payload as IdClaims;
  } catch {
    throw new SignInError("token", "The sign-in token couldn't be verified.");
  }
  if (claims.nonce !== flow.nonce) throw new SignInError("token", "The sign-in token couldn't be verified.");
  if (claims.tid !== cfg.tenantId || !claims.oid) throw new SignInError("token", "This account isn't from the Purpose directory.");

  const email = (claims.email ?? claims.preferred_username ?? "").toLowerCase();
  const role = roleFromClaims(claims.roles);

  const user = await db.transaction(async (tx) => {
    let u = await tx.query.users.findFirst({ where: eq(s.users.entraObjectId, claims.oid!) });
    if (!u && email) {
      const byEmail = await tx.query.users.findFirst({ where: sql`lower(${s.users.email}) = ${email}` });
      if (byEmail?.entraObjectId && byEmail.entraObjectId !== claims.oid) throw new SignInError("conflict", "This email belongs to a different Microsoft account. Ask an admin.");
      if (byEmail) {
        await tx.update(s.users).set({ entraObjectId: claims.oid }).where(and(eq(s.users.id, byEmail.id), isNull(s.users.entraObjectId)));
        await recordAudit(tx, userActor(byEmail, input.request), "user.entra_linked", "user", byEmail.id, {});
        u = { ...byEmail, entraObjectId: claims.oid! };
      }
    }
    if (!u) {
      if (process.env.ENTRA_ALLOW_JIT !== "true" || !email) throw new SignInError("not_provisioned", "You don't have a PATS account yet. Ask your PATS admin for access.");
      const [created] = await tx
        .insert(s.users)
        .values({ email, name: claims.name ?? email, role: role ?? "interviewer", entraObjectId: claims.oid })
        .returning();
      await recordAudit(tx, userActor(created, input.request), "user.created", "user", created.id, { source: "entra_jit", role: created.role });
      u = created;
    }
    if (!u.active) throw new SignInError("inactive", "Your PATS account is deactivated.");
    // Entra app roles are the source of truth when the token carries them.
    if (role && role !== u.role) {
      await tx.update(s.users).set({ role }).where(eq(s.users.id, u.id));
      await recordAudit(tx, userActor(u, input.request), "user.role_changed", "user", u.id, { from: u.role, to: role, source: "entra_app_role" });
      u = { ...u, role };
    }
    if (tokens.refresh_token) {
      const values = { userId: u.id, provider: "entra", refreshTokenEnc: encryptSecret(tokens.refresh_token), scopes: tokens.scope ?? ENTRA_SCOPES.join(" "), updatedAt: new Date() };
      await tx.insert(s.userOauthTokens).values(values).onConflictDoUpdate({ target: s.userOauthTokens.userId, set: values });
    }
    await recordAudit(tx, userActor(u, input.request), "auth.signed_in", "user", u.id, { method: "entra" });
    return u;
  });
  return { user, next: flow.next };
}

/** Where to send the browser to also end the Microsoft session. */
export function signOutUrl(cfg = entraSettings()) {
  const u = new URL(`${cfg.authority}/oauth2/v2.0/logout`);
  u.searchParams.set("post_logout_redirect_uri", cfg.redirectUri.replace(/\/auth\/callback$/, "/login"));
  return u.toString();
}
