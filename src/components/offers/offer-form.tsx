"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { compRange } from "@/lib/utils";
import { createOffer, updateOffer } from "@/server/actions/offers";

export type OfferTerms = {
  baseSalary: number | null;
  bonusPercent: number | null;
  signOnBonus: number | null;
  equity: string | null;
  currency: "CAD" | "USD";
  startDate: string | null;
  openingId: string | null;
  notes: string | null;
};

const EMPTY: OfferTerms = { baseSalary: null, bonusPercent: null, signOnBonus: null, equity: null, currency: "CAD", startDate: null, openingId: null, notes: null };
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/[^\d]/g, "")));

/** Create (applicationId) or edit (offerId) an offer's terms. */
export function OfferForm({
  applicationId,
  offerId,
  initial,
  jobTitle,
  band,
  openings,
  label,
}: {
  applicationId?: string;
  offerId?: string;
  initial?: OfferTerms;
  jobTitle: string;
  band: { min: number | null; max: number | null; currency: string };
  openings: { id: string; code: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState<OfferTerms>(initial ?? EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = (p: Partial<OfferTerms>) => setT((x) => ({ ...x, ...p }));
  const outOfBand = t.baseSalary != null && ((band.min != null && t.baseSalary < band.min) || (band.max != null && t.baseSalary > band.max));

  const save = () =>
    start(async () => {
      setError(null);
      const terms = { ...t, baseSalary: t.baseSalary ?? 0 };
      const res = offerId ? await updateOffer(offerId, terms) : await createOffer({ ...terms, applicationId: applicationId! });
      if ("error" in res) return setError(res.error ?? "Couldn't save the offer.");
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <Button size="sm" variant={offerId ? "secondary" : "primary"} onClick={() => { setT(initial ?? EMPTY); setError(null); setOpen(true); }}>
        {!offerId && <Plus size={13} />} {label}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={offerId ? `Edit offer · ${jobTitle}` : `New offer · ${jobTitle}`}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending || !t.baseSalary} onClick={save}>{pending ? "Saving…" : "Save draft"}</Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="o-base">Base salary</label>
            <input id="o-base" inputMode="numeric" className={inputClass} value={t.baseSalary ?? ""} onChange={(e) => set({ baseSalary: num(e.target.value) })} />
            <p className={outOfBand ? "mt-1 text-xs text-amber-800" : "mt-1 text-xs text-zinc-500"}>
              {outOfBand ? "Outside the job's band: " : "Band: "}
              {compRange(band.min, band.max, band.currency)}
            </p>
          </div>
          <div>
            <label className={labelClass} htmlFor="o-cur">Currency</label>
            <select id="o-cur" className={inputClass} value={t.currency} onChange={(e) => set({ currency: e.target.value as OfferTerms["currency"] })}>
              <option value="CAD">CAD</option>
              <option value="USD">USD</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="o-bonus">Target bonus (%)</label>
            <input id="o-bonus" inputMode="numeric" className={inputClass} value={t.bonusPercent ?? ""} onChange={(e) => set({ bonusPercent: num(e.target.value) })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="o-sign">Sign-on bonus</label>
            <input id="o-sign" inputMode="numeric" className={inputClass} value={t.signOnBonus ?? ""} onChange={(e) => set({ signOnBonus: num(e.target.value) })} />
          </div>
          <div className="col-span-2">
            <label className={labelClass} htmlFor="o-equity">Equity / LTIP</label>
            <input id="o-equity" className={inputClass} value={t.equity ?? ""} onChange={(e) => set({ equity: e.target.value || null })} placeholder="e.g. 2,000 RSUs vesting over 4 years" />
          </div>
          <div>
            <label className={labelClass} htmlFor="o-start">Start date</label>
            <input id="o-start" type="date" className={inputClass} value={t.startDate ?? ""} onChange={(e) => set({ startDate: e.target.value || null })} />
          </div>
          <div>
            <label className={labelClass} htmlFor="o-opening">Opening</label>
            <select id="o-opening" className={inputClass} value={t.openingId ?? ""} onChange={(e) => set({ openingId: e.target.value || null })}>
              <option value="">Next open opening</option>
              {openings.map((o) => <option key={o.id} value={o.id}>{o.code}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className={labelClass} htmlFor="o-notes">Internal notes (not in the letter)</label>
            <textarea id="o-notes" className={`${inputClass} h-16 py-2`} value={t.notes ?? ""} onChange={(e) => set({ notes: e.target.value || null })} />
          </div>
        </div>
        {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
      </Modal>
    </>
  );
}
