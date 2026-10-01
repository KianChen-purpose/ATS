import { desc } from "drizzle-orm";
import { CheckCircle2, CircleDashed, Mail, CalendarDays, MessageSquare, FolderOpen, ShieldCheck, BarChart3 } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { m365Configured } from "@/server/integrations/m365";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Integrations" };

const SERVICES = [
  { key: "directory", name: "Entra ID", icon: ShieldCheck, desc: "SSO, MFA, SCIM user provisioning, manager hierarchy", status: "phase" as const, phase: "Phase 6" },
  { key: "mail", name: "Outlook Mail", icon: Mail, desc: "Send candidate email from your mailbox or careers@, sync replies", status: "ready" as const },
  { key: "calendar", name: "Outlook Calendar", icon: CalendarDays, desc: "Free/busy, create and cancel interview events, rooms", status: "ready" as const },
  { key: "teams", name: "Microsoft Teams", icon: MessageSquare, desc: "Teams meeting links on interviews, notifications and approvals", status: "ready" as const },
  { key: "sharepoint", name: "SharePoint & Word", icon: FolderOpen, desc: "Resume and offer letter storage, Word offer templates", status: "phase" as const, phase: "Phase 3" },
  { key: "powerbi", name: "Power BI & Excel", icon: BarChart3, desc: "Refreshable OData feed and certified dataset", status: "phase" as const, phase: "Phase 5" },
];

export default async function IntegrationsPage() {
  await requireUser();
  const live = m365Configured();
  const events = await db.query.integrationEvents.findMany({ orderBy: desc(schema.integrationEvents.createdAt), limit: 50 });

  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="Microsoft 365 connection for Purpose Unlimited"
        actions={live ? <Badge tone="green">Live · Microsoft Graph</Badge> : <Badge tone="amber">Mock mode</Badge>}
      />
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        {!live && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900">
            <strong>Running in mock mode.</strong> Every Microsoft 365 action (email, calendar, Teams) is simulated and logged
            below. Add <code className="rounded bg-amber-100 px-1">M365_TENANT_ID</code>,{" "}
            <code className="rounded bg-amber-100 px-1">M365_CLIENT_ID</code> and{" "}
            <code className="rounded bg-amber-100 px-1">M365_CLIENT_SECRET</code> to switch to live Microsoft Graph.
          </div>
        )}

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((svc) => (
            <Card key={svc.key} className="p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-sky-50 p-2 text-sky-700">
                  <svc.icon size={18} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold">{svc.name}</div>
                  <div className="mt-0.5 text-xs text-zinc-500">{svc.desc}</div>
                  <div className="mt-2">
                    {svc.status === "ready" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <CheckCircle2 size={13} /> {live ? "Connected" : "Ready (mock)"}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                        <CircleDashed size={13} /> {svc.phase}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader title="Integration activity" />
          {events.length === 0 ? (
            <EmptyState title="No integration calls yet" description="Send an email or schedule an interview to see Microsoft 365 traffic here." />
          ) : (
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] font-medium text-zinc-500 uppercase">
                  <th className="px-4 py-2">Service</th>
                  <th className="px-4 py-2">Operation</th>
                  <th className="px-4 py-2">Details</th>
                  <th className="px-4 py-2">Mode</th>
                  <th className="px-4 py-2 text-right">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {events.map((e) => (
                  <tr key={e.id}>
                    <td className="px-4 py-2 capitalize">{e.service}</td>
                    <td className="px-4 py-2 font-mono text-xs">{e.operation}</td>
                    <td className={`px-4 py-2 ${e.success ? "" : "text-red-700"}`}>{e.summary}</td>
                    <td className="px-4 py-2"><Badge tone={e.mode === "live" ? "green" : "neutral"}>{e.mode}</Badge></td>
                    <td className="px-4 py-2 text-right text-xs text-zinc-500">{timeAgo(e.createdAt)}</td>
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
