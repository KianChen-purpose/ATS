import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requireActor } from "@/lib/session";
import { canSeeProspects } from "@/server/policy";
import { getPool } from "@/server/services/talent-pools";
import { PageHeader } from "@/components/ui/page-header";
import { PoolMembers } from "@/components/sourcing/pool-members";

export const metadata = { title: "Talent pool" };

export default async function PoolPage(props: PageProps<"/sourcing/[id]">) {
  const user = await requireActor();
  if (!canSeeProspects(user)) notFound();
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const data = await getPool(user, id);
  if (!data) notFound();
  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link href="/sourcing" className="rounded p-1 text-zinc-500 hover:bg-zinc-100" aria-label="All pools"><ChevronLeft size={16} /></Link>
            {data.pool.name}
          </span>
        }
        subtitle={`${data.pool.brand?.name ?? "All brands"}${data.pool.description ? ` · ${data.pool.description}` : ""}`}
      />
      <div className="mx-auto max-w-5xl px-6 py-6">
        <PoolMembers poolId={data.pool.id} members={data.members} />
      </div>
    </>
  );
}
