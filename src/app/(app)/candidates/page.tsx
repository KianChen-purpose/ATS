import Link from "next/link";
import { asc } from "drizzle-orm";
import { Plus } from "lucide-react";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/session";
import { listCandidates, getProfileOptions, CANDIDATES_PAGE_SIZE } from "@/server/queries/candidates";
import { canManageRecruiting } from "@/server/permissions";
import { PageHeader } from "@/components/ui/page-header";
import { FilterTabs } from "@/components/ui/filter-tabs";
import { Avatar, candidateColor } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/card";
import { timeAgo } from "@/lib/utils";

export const metadata = { title: "Candidates" };

export default async function CandidatesPage(props: PageProps<"/candidates">) {
  const user = await requireUser();
  const sp = await props.searchParams;
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters = { q: str("q"), jobId: str("job"), status: str("status") ?? "active", sourceId: str("source"), page: Number(str("page") ?? 1) };

  const [{ rows, total, page }, options, sources] = await Promise.all([
    listCandidates(user, filters),
    getProfileOptions(user),
    db.query.sources.findMany({ orderBy: asc(schema.sources.name) }),
  ]);
  const href = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const merged = { q: filters.q, job: filters.jobId, status: filters.status, source: filters.sourceId, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `/candidates?${p}`;
  };
  const pages = Math.max(1, Math.ceil(total / CANDIDATES_PAGE_SIZE));

  return (
    <>
      <PageHeader
        title="Candidates"
        subtitle={`${total.toLocaleString()} candidates`}
        actions={
          canManageRecruiting(user) && (
            <Link href="/candidates/new" className={buttonClass("primary")}>
              <Plus size={14} /> Add candidate
            </Link>
          )
        }
      >
        <FilterTabs
          active={filters.status}
          hrefFor={(key) => href({ status: key, page: undefined })}
          tabs={[
            { key: "active", label: "Active" },
            { key: "hired", label: "Hired" },
            { key: "archived", label: "Archived" },
            { key: "all", label: "All" },
          ]}
        />
      </PageHeader>

      <div className="px-6 py-4">
        <form className="mb-3 flex flex-wrap items-center gap-2">
          <input type="hidden" name="status" value={filters.status} />
          <input name="q" defaultValue={filters.q} placeholder="Search name, email, company, skills, resume…" className="h-8 w-80 rounded-md border border-zinc-200 bg-white px-2.5 outline-none focus:border-accent-500" />
          <select name="job" defaultValue={filters.jobId ?? ""} className="h-8 max-w-64 rounded-md border border-zinc-200 bg-white px-2">
            <option value="">All jobs</option>
            {options.jobs.map((j) => (
              <option key={j.id} value={j.id}>{j.title}</option>
            ))}
          </select>
          <select name="source" defaultValue={filters.sourceId ?? ""} className="h-8 rounded-md border border-zinc-200 bg-white px-2">
            <option value="">All sources</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className={buttonClass("secondary")}>Apply</button>
          {(filters.q || filters.jobId || filters.sourceId) && (
            <Link href={href({ q: undefined, job: undefined, source: undefined })} className="text-xs text-zinc-500 hover:text-zinc-800">Clear</Link>
          )}
        </form>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {rows.length === 0 ? (
            <EmptyState title="No candidates match" />
          ) : (
            <table className="w-full">
              <thead className="border-b border-zinc-200 bg-zinc-50/60">
                <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                  <th className="px-4 py-2">Candidate</th>
                  <th className="px-3 py-2">Applications</th>
                  <th className="px-3 py-2">Tags</th>
                  <th className="px-4 py-2 text-right whitespace-nowrap">Last activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((c) => (
                  <tr key={c.id} className="group hover:bg-zinc-50">
                    <td className="px-4 py-2">
                      <Link href={`/candidates/${c.id}`} className="flex items-center gap-2.5">
                        <Avatar name={`${c.firstName} ${c.lastName}`} color={candidateColor(c.firstName + c.lastName)} size={28} />
                        <span className="min-w-0">
                          <span className="block font-medium text-zinc-900 group-hover:text-accent-700">{c.firstName} {c.lastName}</span>
                          <span className="block truncate text-xs text-zinc-500">{[c.currentTitle, c.currentCompany].filter(Boolean).join(" at ")}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="space-y-0.5">
                        {c.apps.slice(0, 2).map((a) => (
                          <div key={a.id} className="flex items-center gap-1.5 text-xs">
                            <Link href={`/jobs/${a.jobId}`} className="truncate text-zinc-700 hover:underline">{a.jobTitle}</Link>
                            <Badge tone={a.status === "hired" ? "green" : a.status === "archived" ? "neutral" : "accent"}>
                              {a.status === "hired" ? "Hired" : a.stage}
                            </Badge>
                          </div>
                        ))}
                        {c.apps.length > 2 && <div className="text-[11px] text-zinc-400">+{c.apps.length - 2} more</div>}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <span key={t} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-600">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right text-xs text-zinc-500">{timeAgo(c.lastActivity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {pages > 1 && (
          <div className="mt-3 flex items-center justify-between text-xs text-zinc-500">
            <span>Page {page} of {pages}</span>
            <div className="flex gap-2">
              {page > 1 && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page - 1) })}>Previous</Link>}
              {page < pages && <Link className={buttonClass("secondary", "sm")} href={href({ page: String(page + 1) })}>Next</Link>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
