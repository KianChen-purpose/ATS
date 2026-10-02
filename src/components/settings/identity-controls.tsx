"use client";

import { useState, useTransition } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/modal";
import { CopyField } from "@/components/reports/feed-tokens";
import { createScimTokenAction, revokeScimTokenAction, setGroupRoleAction } from "@/server/actions/identity";
import { ROLE_LABELS } from "@/lib/utils";

export function NewScimToken() {
  const [token, setToken] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (token)
    return (
      <div className="space-y-2 rounded-md border border-zinc-300 bg-zinc-50 p-3" role="status">
        <p className="text-[13px] font-medium">Paste this into Entra as the Secret Token now. It won&apos;t be shown again.</p>
        <CopyField value={token} label="SCIM token" />
        <Button size="sm" variant="ghost" onClick={() => setToken(null)}>
          Done
        </Button>
      </div>
    );
  return (
    <Button disabled={pending} onClick={() => start(async () => setToken((await createScimTokenAction("Entra provisioning")).token))}>
      <KeyRound size={14} /> Create SCIM token
    </Button>
  );
}

export function RevokeScimToken({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="ghost" disabled={pending} onClick={() => confirm("Revoke this token? Provisioning stops until Entra has a new one.") && start(() => revokeScimTokenAction(id))}>
      Revoke
    </Button>
  );
}

export function GroupRoleSelect({ groupId, role, roles }: { groupId: string; role: string | null; roles: readonly string[] }) {
  const [pending, start] = useTransition();
  return (
    <select
      aria-label="PATS role for this group"
      className={`${inputClass} w-48`}
      defaultValue={role ?? ""}
      disabled={pending}
      onChange={(e) => start(() => setGroupRoleAction(groupId, e.target.value))}
    >
      <option value="">No role (ignored)</option>
      {roles.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}
