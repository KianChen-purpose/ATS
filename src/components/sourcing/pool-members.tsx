"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { addToTalentPool, createProspect, removeFromTalentPool, searchCandidatesForPool, setProspectStage } from "@/server/actions/talent-pools";

const STAGES = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "applied", label: "Applied" },
] as const;

type Member = {
  candidateId: string;
  firstName: string;
  lastName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  stage: (typeof STAGES)[number]["value"];
  applications: number;
  talentPoolConsent: boolean;
  addedBy: string | null;
};

export function PoolMembers({ poolId, members }: { poolId: string; members: Member[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [filter, setFilter] = useState<string>("all");
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });
  const shown = filter === "all" ? members : members.filter((m) => m.stage === filter);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by stage">
          {[{ value: "all", label: "All" }, ...STAGES].map((st) => (
            <button
              key={st.value}
              onClick={() => setFilter(st.value)}
              aria-pressed={filter === st.value}
              className={filter === st.value ? "rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-medium text-white" : "rounded-md px-2.5 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100"}
            >
              {st.label} <span className="opacity-70">{st.value === "all" ? members.length : members.filter((m) => m.stage === st.value).length}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <AddExisting poolId={poolId} />
          <NewProspect poolId={poolId} />
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-zinc-500">No one here yet.</p>
        ) : (
          <table className="w-full">
            <thead className="border-b border-zinc-200 bg-zinc-50/60">
              <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
                <th className="px-4 py-2">Person</th>
                <th className="px-3 py-2">Stage</th>
                <th className="px-3 py-2">Consent</th>
                <th className="px-3 py-2">Added by</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {shown.map((m) => (
                <tr key={m.candidateId}>
                  <td className="px-4 py-2">
                    <Link href={`/candidates/${m.candidateId}`} className="flex items-center gap-2.5 hover:text-accent-700">
                      <Avatar name={`${m.firstName} ${m.lastName}`} size={26} />
                      <span>
                        <span className="block font-medium">{m.firstName} {m.lastName}</span>
                        <span className="block text-xs text-zinc-500">{[m.currentTitle, m.currentCompany].filter(Boolean).join(" at ") || (m.applications ? `${m.applications} application(s)` : "Prospect")}</span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Stage for ${m.firstName} ${m.lastName}`}
                      value={m.stage}
                      disabled={pending}
                      onChange={(e) => run(() => setProspectStage(poolId, m.candidateId, e.target.value))}
                      className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs"
                    >
                      {STAGES.map((st) => <option key={st.value} value={st.value}>{st.label}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">{m.talentPoolConsent ? <Badge tone="green">Future roles</Badge> : <Badge tone="neutral">None on file</Badge>}</td>
                  <td className="px-3 py-2 text-xs text-zinc-500">{m.addedBy ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button disabled={pending} onClick={() => run(() => removeFromTalentPool(poolId, m.candidateId))} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label={`Remove ${m.firstName} ${m.lastName} from pool`}>
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AddExisting({ poolId }: { poolId: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; subtitle: string }[]>([]);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}><Search size={13} /> Add existing</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Add people already in PATS">
        <form onSubmit={(e) => { e.preventDefault(); start(async () => setResults(await searchCandidatesForPool(poolId, q))); }} className="flex gap-2">
          <input aria-label="Search candidates" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, company, title…" autoFocus />
          <Button disabled={pending}>Search</Button>
        </form>
        {results.length === 0 && q.length > 1 && !pending && <p className="mt-3 text-xs text-zinc-500">No one to add — they may already be in this pool.</p>}
        <ul className="mt-3 divide-y divide-zinc-100">
          {results.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span><span className="block font-medium">{r.name}</span><span className="block text-xs text-zinc-500">{r.subtitle}</span></span>
              <Button size="sm" disabled={pending} onClick={() => start(async () => { await addToTalentPool(poolId, r.id); setResults(results.filter((x) => x.id !== r.id)); router.refresh(); })}>Add</Button>
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}

function NewProspect({ poolId }: { poolId: string }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ firstName: "", lastName: "", email: "", linkedinUrl: "", currentTitle: "", currentCompany: "", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <>
      <Button size="sm" variant="primary" onClick={() => { setMsg(null); setOpen(true); }}><Plus size={13} /> New prospect</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New prospect"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await createProspect({ poolId, ...f });
                  if ("error" in r) return setMsg(r.error ?? "Check the details.");
                  if ("duplicateId" in r) return setMsg("Someone with this email is already in PATS. Use “Add existing” to add them.");
                  setOpen(false);
                  setF({ firstName: "", lastName: "", email: "", linkedinUrl: "", currentTitle: "", currentCompany: "", note: "" });
                  router.refresh();
                })
              }
            >
              Add prospect
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelClass} htmlFor="np-first">First name</label><input id="np-first" className={inputClass} value={f.firstName} onChange={set("firstName")} /></div>
          <div><label className={labelClass} htmlFor="np-last">Last name</label><input id="np-last" className={inputClass} value={f.lastName} onChange={set("lastName")} /></div>
          <div><label className={labelClass} htmlFor="np-email">Email</label><input id="np-email" type="email" className={inputClass} value={f.email} onChange={set("email")} /></div>
          <div><label className={labelClass} htmlFor="np-li">LinkedIn URL</label><input id="np-li" className={inputClass} value={f.linkedinUrl} onChange={set("linkedinUrl")} /></div>
          <div><label className={labelClass} htmlFor="np-title">Current title</label><input id="np-title" className={inputClass} value={f.currentTitle} onChange={set("currentTitle")} /></div>
          <div><label className={labelClass} htmlFor="np-co">Company</label><input id="np-co" className={inputClass} value={f.currentCompany} onChange={set("currentCompany")} /></div>
          <div className="col-span-2"><label className={labelClass} htmlFor="np-note">Note</label><textarea id="np-note" className={`${inputClass} h-16 py-2`} value={f.note} onChange={set("note")} /></div>
        </div>
        <p className="mt-2 text-xs text-zinc-500">Prospects haven&apos;t applied or consented. Ask for consent when you first reach out.</p>
        {msg && <p className="mt-2 text-xs text-red-700">{msg}</p>}
      </Modal>
    </>
  );
}
