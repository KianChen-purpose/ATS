import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { canViewSettings } from "@/server/policy";
import { entraConfigured, demoAuthEnabled } from "@/server/config";
import { APP_ROLE_MAP } from "@/server/services/entra-auth";
import { listGroupMappings, listScimTokens, ROLES } from "@/server/services/scim";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CopyField } from "@/components/reports/feed-tokens";
import { GroupRoleSelect, NewScimToken, RevokeScimToken } from "@/components/settings/identity-controls";
import { fmt, ROLE_LABELS, timeAgo } from "@/lib/utils";

export const metadata = { title: "Identity" };

export default async function IdentityPage() {
  const user = await requireActor();
  if (!canViewSettings(user)) notFound();
  const h = await headers();
  const origin = process.env.APP_URL ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const [tokens, groups] = await Promise.all([listScimTokens(user), listGroupMappings(user)]);
  const sso = entraConfigured();

  return (
    <>
      <PageHeader title="Identity" subtitle="Microsoft sign-in, provisioning and roles">
        <SettingsTabs active="identity" />
      </PageHeader>
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <Card>
          <CardHeader title="Microsoft sign-in (Entra ID)" action={sso ? <Badge tone="green">On</Badge> : <Badge tone="amber">Not configured</Badge>} />
          <div className="space-y-3 px-4 py-3 text-[13px] text-zinc-700">
            <p>
              {sso ? "Staff sign in with their Purpose Microsoft account. MFA and device rules come from Conditional Access in Entra." : "Set M365_TENANT_ID, M365_CLIENT_ID, M365_CLIENT_SECRET and TOKEN_ENCRYPTION_KEY to turn on Microsoft sign-in."}
              {demoAuthEnabled() && " Demo sign-in is also on (never in production)."}
            </p>
            <div className="max-w-xl">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Redirect URI to register in Entra</span>
              <CopyField value={`${origin.replace(/\/$/, "")}/auth/callback`} label="Redirect URI" />
            </div>
            <div>
              <span className="mb-1 block text-xs font-medium text-zinc-600">App roles (assign Entra groups to these; the highest wins at each sign-in)</span>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(APP_ROLE_MAP).map(([value, role]) => (
                  <span key={value} className="rounded bg-zinc-100 px-2 py-0.5 text-xs">
                    <code>{value}</code> → {ROLE_LABELS[role]}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="Provisioning (SCIM 2.0)" action={<NewScimToken />} />
          <div className="space-y-3 px-4 py-3 text-[13px] text-zinc-700">
            <p>In the PATS enterprise app in Entra, set provisioning to Automatic with this tenant URL and a token from here. Map <code>objectId</code> to <code>externalId</code>. Removing someone in Entra deactivates them in PATS and revokes PATS&apos;s access to their mailbox; their history stays.</p>
            <div className="max-w-xl">
              <span className="mb-1 block text-xs font-medium text-zinc-600">Tenant URL</span>
              <CopyField value={`${origin.replace(/\/$/, "")}/api/scim/v2`} label="SCIM tenant URL" />
            </div>
          </div>
          {tokens.length > 0 && (
            <table className="w-full border-t border-zinc-100 text-[13px]">
              <tbody className="divide-y divide-zinc-100">
                {tokens.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-600">{t.prefix}…</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">Created {fmt(t.createdAt, "MMM d, yyyy", user.timezone)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{t.lastUsedAt ? `Used ${timeAgo(t.lastUsedAt)}` : "Never used"}</td>
                    <td className="px-4 py-2 text-right">{t.revokedAt ? <span className="text-xs text-zinc-500">Revoked</span> : <RevokeScimToken id={t.id} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card>
          <CardHeader title="Group roles" />
          <p className="px-4 pt-3 text-xs text-zinc-500">Groups Entra provisions appear here. Map a group to a PATS role and its members get that role (the highest wins). Use either this or Entra app roles, not both.</p>
          {groups.length === 0 ? (
            <EmptyState title="No groups provisioned yet" description="Assign groups to the PATS enterprise app in Entra and start provisioning." />
          ) : (
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-zinc-100">
                {groups.map((g) => (
                  <tr key={g.id}>
                    <td className="px-4 py-2 font-medium">{g.displayName}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{g.members} {g.members === 1 ? "member" : "members"}</td>
                    <td className="px-4 py-2 text-right">
                      <GroupRoleSelect groupId={g.id} role={g.role} roles={ROLES} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
