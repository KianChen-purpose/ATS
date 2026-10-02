import Link from "next/link";
import { notFound } from "next/navigation";
import { requireActor } from "@/lib/session";
import { canSeeProspects } from "@/server/policy";
import { listPools } from "@/server/services/talent-pools";
import { listBrands } from "@/server/services/jobs";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { NewPoolForm } from "@/components/sourcing/new-pool-form";

export const metadata = { title: "Sourcing" };

export default async function SourcingPage() {
  const user = await requireActor();
  if (!canSeeProspects(user)) notFound();
  const [pools, brands] = await Promise.all([listPools(user), listBrands()]);
  return (
    <>
      <PageHeader title="Sourcing" subtitle="Talent pools of prospects not tied to a job" />
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <Card>
          <CardHeader title="Talent pools" />
          {pools.length === 0 ? (
            <EmptyState title="No pools yet" description="Create one below to start sourcing." />
          ) : (
            <ul className="divide-y divide-zinc-100">
              {pools.map((p) => (
                <li key={p.id}>
                  <Link href={`/sourcing/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50">
                    <span>
                      <span className="block font-medium">{p.name}</span>
                      <span className="block text-xs text-zinc-500">{p.brand?.name ?? "All brands"}{p.owner && ` · ${p.owner.name}`}{p.description && ` · ${p.description}`}</span>
                    </span>
                    <span className="text-right text-xs text-zinc-600">
                      <span className="block font-medium text-zinc-900">{p.members} people</span>
                      {(p.byStage.interested ?? 0) > 0 && <span>{p.byStage.interested} interested</span>}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="border-t border-zinc-100 px-4 py-4"><NewPoolForm brands={brands.map((b) => ({ id: b.id, name: b.name }))} /></div>
        </Card>
        <p className="text-xs text-zinc-500">Email sequences, the browser extension and engagement tracking come with the background worker (ARCHITECTURE.md D5).</p>
      </div>
    </>
  );
}
