"use client";

import Link from "next/link";
import { useActionState } from "react";
import { createCandidate } from "@/server/actions/candidates";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/form-field";

export function NewCandidateForm({ jobs, sources, defaultJobId }: { jobs: { id: string; title: string; brand: string }[]; sources: { id: string; name: string }[]; defaultJobId?: string }) {
  const [state, action, pending] = useActionState(createCandidate, null);
  return (
    <form action={action} className="space-y-5">
      {state?.error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">
          {state.error}
          {"duplicateId" in state && state.duplicateId && (
            <Link href={`/candidates/${state.duplicateId}`} className="ml-2 font-medium underline">View existing profile</Link>
          )}
        </div>
      )}
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Candidate</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="First name"><input name="firstName" required className={inputClass} /></Field>
          <Field label="Last name"><input name="lastName" required className={inputClass} /></Field>
          <Field label="Email"><input name="email" type="email" className={inputClass} /></Field>
          <Field label="Phone"><input name="phone" className={inputClass} /></Field>
          <Field label="Current title"><input name="currentTitle" className={inputClass} /></Field>
          <Field label="Current company"><input name="currentCompany" className={inputClass} /></Field>
          <Field label="Location"><input name="location" className={inputClass} placeholder="Toronto, ON" /></Field>
          <Field label="LinkedIn URL"><input name="linkedinUrl" className={inputClass} placeholder="https://www.linkedin.com/in/…" /></Field>
        </div>
        <Field label="Tags" hint="Comma separated, e.g. Python, CFA, Bilingual EN/FR"><input name="tags" className={inputClass} /></Field>
        <Field label="Resume (paste text)"><textarea name="resumeText" rows={6} className={inputClass} /></Field>
      </section>
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Add to job (optional)</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Job">
            <select name="jobId" defaultValue={defaultJobId ?? ""} className={inputClass}>
              <option value="">Don&apos;t add to a job</option>
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.brand}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <select name="sourceId" className={inputClass}>
              <option value="">—</option>
              {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
      </section>
      <div className="flex justify-end">
        <Button variant="primary" disabled={pending}>{pending ? "Adding…" : "Add candidate"}</Button>
      </div>
    </form>
  );
}
