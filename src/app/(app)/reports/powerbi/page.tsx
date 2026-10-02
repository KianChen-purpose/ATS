import { headers } from "next/headers";
import { requireActor } from "@/lib/session";
import { feedCatalogue, listFeedTokens } from "@/server/services/reports/feed";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { CopyField, NewFeedToken, RevokeToken } from "@/components/reports/feed-tokens";
import { NoReportAccess, ReportShell, reportFilters } from "@/components/reports/report-page";
import { fmt, timeAgo } from "@/lib/utils";

export const metadata = { title: "Power BI & Excel" };

export default async function PowerBiPage(props: PageProps<"/reports/powerbi">) {
  const actor = await requireActor();
  const f = reportFilters(actor, await props.searchParams);
  if (!f) return <NoReportAccess />;
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const [tokens, sets] = await Promise.all([listFeedTokens(actor), Promise.resolve(feedCatalogue(actor))]);
  const now = new Date();

  return (
    <ReportShell actor={actor} tab="powerbi" filters={f} subtitle="A refreshable OData feed for Power BI and Excel, limited to the jobs and fields you can see.">
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <Card className="min-w-0">
          <CardHeader title="Connect" />
          <ol className="list-decimal space-y-3 px-8 py-4 text-[13px] text-zinc-700">
            <li>Create a feed token below and copy it.</li>
            <li>
              In Power BI Desktop choose <strong>Get data → OData feed</strong> (in Excel: <strong>Data → Get Data → From Other Sources → From OData Feed</strong>) and paste this URL:
              <div className="mt-1.5 max-w-xl">
                <CopyField value={`${origin}/api/odata`} label="Feed URL" />
              </div>
            </li>
            <li>
              When asked how to sign in, choose <strong>Basic</strong>. Type anything as the user name and paste the token as the password.
            </li>
            <li>Pick the tables you need. Join them on their Id columns (for example Applications.JobId → Jobs.Id) and filter in Power Query; the feed returns whole tables, page by page.</li>
          </ol>
          <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
            The feed runs as you: if your access changes, so does what it returns. It carries ids rather than candidate names or contact details. Every refresh is recorded in the audit log.
          </p>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Tables you can load" />
          <ul className="divide-y divide-zinc-100 text-[13px]">
            {sets.map((e) => (
              <li key={e.name} className="px-4 py-2">
                <span className="font-medium">{e.name}</span>
                <span className="block text-xs break-words text-zinc-500">{e.properties.map((p) => p.name).join(", ")}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card>
        <CardHeader title="Your feed tokens" />
        <div className="border-b border-zinc-100 px-4 py-3">
          <NewFeedToken />
        </div>
        {tokens.length === 0 ? (
          <EmptyState title="No tokens yet" description="Create one to connect Power BI or Excel." />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="border-b border-zinc-100">
              <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-3 py-2 font-medium">Token</th>
                <th className="px-3 py-2 font-medium">Created</th>
                <th className="px-3 py-2 font-medium">Last used</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {tokens.map((t) => {
                const status = t.revokedAt ? "Revoked" : t.expiresAt <= now ? "Expired" : `Expires ${fmt(t.expiresAt, "MMM d, yyyy", f.tz)}`;
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2 font-medium">{t.name}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-600">{t.prefix}…</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{fmt(t.createdAt, "MMM d, yyyy", f.tz)}</td>
                    <td className="px-3 py-2 text-xs text-zinc-600">{t.lastUsedAt ? timeAgo(t.lastUsedAt) : "Never"}</td>
                    <td className="px-3 py-2 text-xs">{status}</td>
                    <td className="px-4 py-2 text-right">{!t.revokedAt && t.expiresAt > now && <RevokeToken id={t.id} name={t.name} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
    </ReportShell>
  );
}
