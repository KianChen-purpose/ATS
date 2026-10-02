import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireActor } from "@/lib/session";
import { canViewSettings } from "@/server/policy";
import { listChains } from "@/server/services/approvals";
import { getJobFormOptions } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { ChainEditor } from "@/components/settings/chain-editor";
import { ChainActiveToggle } from "@/components/settings/chain-active-toggle";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/card";
import { money } from "@/lib/utils";

export const metadata = { title: "Approval chains" };

const APPROVER_LABEL = { hiring_manager: "Hiring manager", recruiter: "Recruiter" } as const;

export default async function ApprovalSettingsPage() {
  const user = await requireActor();
  if (!canViewSettings(user)) notFound();
  const [chains, options] = await Promise.all([listChains(user), getJobFormOptions(user)]);
  const opts = { brands: options.brands, departments: options.departments, people: options.users };

  const sections = [
    { subject: "job" as const, title: "New jobs (requisitions)", help: "A job submitted to open waits for these approvals first." },
    { subject: "offer" as const, title: "Offers", help: "An offer needs these approvals before it can be sent. Higher thresholds win when several apply." },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Approval chains for Purpose Unlimited brands"
        actions={<ChainEditor {...opts} buttonLabel="New chain" buttonVariant="primary" />}
      >
        <SettingsTabs active="approvals" />
      </PageHeader>
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <p className="text-zinc-600">
          The most specific active chain applies: a brand-specific chain beats an all-brands one, a department-specific chain beats an all-departments one,
          and for offers the highest salary threshold that is met wins. If no chain applies, no approval is needed.
        </p>
        {sections.map((sec) => {
          const list = chains.filter((c) => c.subject === sec.subject);
          return (
            <section key={sec.subject}>
              <h2 className="text-base">{sec.title}</h2>
              <p className="mb-2 text-xs text-zinc-500">{sec.help}</p>
              <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
                {list.length === 0 ? (
                  <EmptyState title="No chains" description="Without a chain, these don't need approval." />
                ) : (
                  list.map((c) => (
                    <div key={c.id} className="flex items-start gap-4 px-4 py-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 font-medium">
                          {c.name}
                          {!c.active && <Badge tone="neutral">Inactive</Badge>}
                        </div>
                        <div className="mt-0.5 text-xs text-zinc-500">
                          {c.brand?.name ?? "All brands"} · {c.department?.name ?? "All departments"}
                          {c.minAmount != null && <> · Base salary ≥ {money(c.minAmount)}</>}
                        </div>
                        <ol className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                          {c.steps.map((st, i) => (
                            <li key={st.id} className="flex items-center gap-1">
                              {i > 0 && <ChevronRight size={12} className="text-zinc-400" aria-hidden />}
                              <span className="rounded bg-zinc-100 px-1.5 py-0.5">{st.approverType === "user" ? st.approver?.name : APPROVER_LABEL[st.approverType]}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                      <ChainActiveToggle chainId={c.id} active={c.active} />
                      <ChainEditor
                        {...opts}
                        chain={{
                          id: c.id,
                          name: c.name,
                          subject: c.subject,
                          brandId: c.brandId,
                          departmentId: c.departmentId,
                          minAmount: c.minAmount,
                          steps: c.steps.map((st) => ({ approverType: st.approverType, approverId: st.approverId })),
                        }}
                        buttonLabel="Edit"
                        buttonSize="sm"
                      />
                    </div>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
