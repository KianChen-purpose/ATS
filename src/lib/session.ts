import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db, schema } from "@/db";
import { sessionSecret } from "@/server/config";

export const SESSION_COOKIE = "pats_session";
const secret = () => sessionSecret();

export async function createSession(userId: string) {
  const token = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
}

export async function destroySession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    const user = await db.query.users.findFirst({ where: eq(schema.users.id, payload.sub) });
    return user?.active ? user : null;
  } catch {
    return null;
  }
});

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/** The signed-in user as a policy actor, for passing to services. Redirects to /login if signed out. */
export const requireActor = cache(async () => {
  const { userActor } = await import("@/server/policy/actor");
  const user = await requireUser();
  const h = await headers();
  return userActor(user, {
    requestId: h.get("x-request-id") ?? h.get("x-ms-request-id") ?? crypto.randomUUID(),
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  });
});
