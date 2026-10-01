"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createSession, destroySession } from "@/lib/session";
import { findActiveUser } from "@/server/services/users";

/** Demo sign-in: pick any seeded user. Replaced by Entra ID SSO when M365 is configured. */
export async function signInAs(formData: FormData) {
  const userId = z.string().uuid().safeParse(formData.get("userId"));
  const user = userId.success ? await findActiveUser(userId.data) : null;
  if (!user) redirect("/login");
  await createSession(user.id);
  redirect("/");
}

export async function signOut() {
  await destroySession();
  redirect("/login");
}
