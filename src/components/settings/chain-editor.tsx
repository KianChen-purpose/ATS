"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { saveApprovalChain } from "@/server/actions/approvals";

type Opt = { id: string; name: string };
type Step = { approverType: "user" | "hiring_manager" | "recruiter"; approverId: string | null };
export type ChainDraft = {
  id?: string;
  name: string;
  subject: "job" | "offer";
  brandId: string | null;
  departmentId: string | null;
  minAmount: number | null;
  steps: Step[];
};

const EMPTY: ChainDraft = { name: "", subject: "offer", brandId: null, departmentId: null, minAmount: null, steps: [{ approverType: "hiring_manager", approverId: null }] };

export function ChainEditor({
  chain,
  brands,
  departments,
  people,
  buttonLabel,
  buttonVariant = "secondary",
  buttonSize = "md",
}: {
  chain?: ChainDraft;
  brands: Opt[];
  departments: Opt[];
  people: Opt[];
  buttonLabel: string;
  buttonVariant?: "primary" | "secondary";
  buttonSize?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ChainDraft>(chain ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (patch: Partial<ChainDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setStep = (i: number, patch: Partial<Step>) => set({ steps: draft.steps.map((st, j) => (j === i ? { ...st, ...patch } : st)) });

  const save = () =>
    start(async () => {
      setError(null);
      const res = await saveApprovalChain({ ...draft, minAmount: draft.subject === "offer" ? draft.minAmount : null });
      if ("error" in res) return setError(res.error ?? "Couldn't save the chain.");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button
        variant={buttonVariant}
        size={buttonSize}
        onClick={() => {
          setDraft(chain ?? EMPTY);
          setError(null);
          setOpen(true);
        }}
      >
        {!chain && <Plus size={14} />} {buttonLabel}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={chain ? "Edit approval chain" : "New approval chain"}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={save}>{pending ? "Saving…" : "Save chain"}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div>
            <label className={labelClass}>Name</label>
            <input className={inputClass} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Offers – Purpose Investments" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Applies to</label>
              <select className={inputClass} value={draft.subject} onChange={(e) => set({ subject: e.target.value as ChainDraft["subject"] })}>
                <option value="offer">Offers</option>
                <option value="job">New jobs (requisitions)</option>
              </select>
            </div>
            {draft.subject === "offer" && (
              <div>
                <label className={labelClass}>When base salary is at least</label>
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="Any amount"
                  value={draft.minAmount ?? ""}
                  onChange={(e) => set({ minAmount: e.target.value ? Number(e.target.value.replace(/\D/g, "")) : null })}
                />
              </div>
            )}
            <div>
              <label className={labelClass}>Brand</label>
              <select className={inputClass} value={draft.brandId ?? ""} onChange={(e) => set({ brandId: e.target.value || null })}>
                <option value="">All brands</option>
                {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className={labelClass}>Department</label>
              <select className={inputClass} value={draft.departmentId ?? ""} onChange={(e) => set({ departmentId: e.target.value || null })}>
                <option value="">All departments</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>Approvers, in order</label>
            <ol className="space-y-1.5">
              {draft.steps.map((st, i) => (
                <li key={i}>
                  {i > 0 && <ArrowDown size={12} className="mx-auto mb-1.5 text-zinc-400" aria-hidden />}
                  <div className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-zinc-500">{i + 1}.</span>
                    <select className={inputClass} value={st.approverType} onChange={(e) => setStep(i, { approverType: e.target.value as Step["approverType"], approverId: null })}>
                      <option value="hiring_manager">The job&apos;s hiring manager</option>
                      <option value="recruiter">The job&apos;s recruiter</option>
                      <option value="user">A specific person…</option>
                    </select>
                    {st.approverType === "user" && (
                      <select className={inputClass} value={st.approverId ?? ""} onChange={(e) => setStep(i, { approverId: e.target.value || null })} aria-label={`Approver ${i + 1}`}>
                        <option value="">Pick a person</option>
                        {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    )}
                    <button
                      type="button"
                      disabled={draft.steps.length === 1}
                      onClick={() => set({ steps: draft.steps.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30"
                      aria-label={`Remove approver ${i + 1}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            <Button size="sm" className="mt-2" onClick={() => set({ steps: [...draft.steps, { approverType: "user", approverId: null }] })}>
              <Plus size={13} /> Add approver
            </Button>
          </div>
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
        </div>
      </Modal>
    </>
  );
}
