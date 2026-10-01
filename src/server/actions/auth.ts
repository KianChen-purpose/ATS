"use server";

import { redirect } from "next/navigation";
import { createSession, destroySession } from "@/lib/session";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

/** Demo sign-in: pick any seeded user. Replaced by Entra ID SSO when M365 is configured. */
export async function signInAs(formData: FormData) {
  const userId = String(formData.get("userId") ?? "");
  const user = await db.query.users.findFirst({ where: eq(schema.users.id, userId) });
  if (!user) redirect("/login");
  await createSession(user.id);
  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
