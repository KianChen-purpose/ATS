"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireActor } from "@/lib/session";
import * as scim from "@/server/services/scim";

export async function createScimTokenAction(name: string) {
  const r = await scim.createScimToken(await requireActor(), name);
  revalidatePath("/settings/identity");
  return { token: r.token };
}

export async function revokeScimTokenAction(id: string) {
  await scim.revokeScimToken(await requireActor(), z.uuid().parse(id));
  revalidatePath("/settings/identity");
}

export async function setGroupRoleAction(groupId: string, role: string) {
  const r = z.enum(scim.ROLES).nullable().parse(role === "" ? null : role);
  await scim.setGroupRole(await requireActor(), z.uuid().parse(groupId), r);
  revalidatePath("/settings/identity");
}
