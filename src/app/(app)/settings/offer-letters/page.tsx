import { notFound } from "next/navigation";
import { Download, FileText } from "lucide-react";
import { requireActor } from "@/lib/session";
import { canViewSettings } from "@/server/policy";
import { listBrands } from "@/server/services/jobs";
import { listTemplates, MERGE_FIELDS } from "@/server/services/offer-letters";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { TemplateUpload } from "@/components/settings/template-upload";
import { TemplateActiveToggle } from "@/components/settings/template-active-toggle";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Offer letters" };

export default async function OfferLetterSettingsPage() {
  const user = await requireActor();
  if (!canViewSettings(user)) notFound();
  const [templates, brands] = await Promise.all([listTemplates(user), listBrands()]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Word offer letter templates">
        <SettingsTabs active="offer-letters" />
      </PageHeader>
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <p className="text-zinc-600">
          When an offer is sent, PATS fills in the best match for the job&apos;s brand and the candidate&apos;s language: brand-specific first, then all-brands,
          falling back to English. The letter is attached to the offer email and kept with the offer.
        </p>
        <Card>
          <CardHeader title="Templates" />
          {templates.length === 0 ? (
            <EmptyState title="No templates yet" description="Upload a Word file below." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <FileText size={16} className="text-zinc-400" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {t.name} {!t.active && <Badge tone="neutral">Inactive</Badge>}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {t.brand?.name ?? "All brands"} · {t.locale === "fr-CA" ? "Français (CA)" : "English"} · added {timeAgo(t.createdAt)}
                    </div>
                  </div>
                  <a href={`/api/files/${t.fileId}`} className="inline-flex items-center gap-1 text-xs text-accent-700 hover:underline">
                    <Download size={12} /> Download
                  </a>
                  <TemplateActiveToggle templateId={t.id} active={t.active} />
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-zinc-100 px-4 py-4">
            <TemplateUpload brands={brands.map((b) => ({ id: b.id, name: b.name }))} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Merge fields" />
          <div className="px-4 py-3 text-xs text-zinc-600">
            <p className="mb-2">
              Type these in the Word file exactly as shown. Optional parts go between a section&apos;s start and end tags and disappear when empty, e.g.{" "}
              <code className="rounded bg-zinc-100 px-1">{"{#bonus}Target bonus: {bonus_percent}%{/bonus}"}</code>.
            </p>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {Object.entries(MERGE_FIELDS).map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt><code className="rounded bg-zinc-100 px-1">{`{${k}}`}</code></dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </Card>
      </div>
    </>
  );
}
