"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { referCandidate, type ReferralState } from "@/server/actions/referrals";

export function ReferralForm({ jobs }: { jobs: { id: string; title: string; brand: string; location: string | null }[] }) {
  const [state, action, pending] = useActionState<ReferralState, FormData>(referCandidate, { status: "idle" });
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.status === "done") form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="space-y-3">
      {state.status === "done" && (
        <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
          {state.alreadyReferred ? "You've already referred this person for that role." : "Thanks! The recruiter has your referral and will follow up."}
        </p>
      )}
      {state.status === "error" && <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">{state.error}</p>}
      <div>
        <label className={labelClass} htmlFor="r-job">Role</label>
        <select id="r-job" name="jobId" required defaultValue="" className={inputClass}>
          <option value="" disabled>Choose an open role…</option>
          {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} · {j.brand}{j.location ? ` · ${j.location}` : ""}</option>)}
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><label className={labelClass} htmlFor="r-first">First name</label><input id="r-first" name="firstName" required className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="r-last">Last name</label><input id="r-last" name="lastName" required className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="r-email">Email</label><input id="r-email" name="email" type="email" required className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="r-phone">Phone</label><input id="r-phone" name="phone" type="tel" className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="r-li">LinkedIn URL</label><input id="r-li" name="linkedinUrl" type="url" className={inputClass} /></div>
        <div><label className={labelClass} htmlFor="r-rel">How you know them</label><input id="r-rel" name="relationship" placeholder="e.g. Worked together at RBC" className={inputClass} /></div>
      </div>
      <div>
        <label className={labelClass} htmlFor="r-note">Why they&apos;d be great</label>
        <textarea id="r-note" name="note" required minLength={10} rows={4} className={`${inputClass} py-2`} />
      </div>
      <div>
        <label className={labelClass} htmlFor="r-cv">Resume (optional, PDF or Word)</label>
        <input id="r-cv" name="resume" type="file" accept=".pdf,.docx" className="block w-full text-xs" />
      </div>
      <p className="text-xs text-zinc-500">Let them know you&apos;re referring them. The recruiter will ask for their consent when they first get in touch.</p>
      <Button variant="primary" disabled={pending}>{pending ? "Sending…" : "Submit referral"}</Button>
    </form>
  );
}
