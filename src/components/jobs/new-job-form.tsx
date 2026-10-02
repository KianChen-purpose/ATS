"use client";

import { useActionState } from "react";
import { createJob } from "@/server/actions/jobs";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/ui/form-field";

type Opt = { id: string; name: string };

export function NewJobForm({ brands, departments, locations, users }: { brands: Opt[]; departments: Opt[]; locations: Opt[]; users: (Opt & { role: string })[] }) {
  const [state, action, pending] = useActionState(createJob, null);
  const hms = users.filter((u) => ["hiring_manager", "executive", "admin"].includes(u.role));
  const recruiters = users.filter((u) => ["recruiter", "admin"].includes(u.role));
  const coordinators = users.filter((u) => u.role === "coordinator");

  return (
    <form action={action} className="space-y-5">
      {state?.error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{state.error}</div>}
      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Basics</h2>
        <Field label="Job title">
          <input name="title" required className={inputClass} placeholder="e.g. Senior Software Engineer" />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Brand">
            <select name="brandId" className={inputClass}>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="Department">
            <select name="departmentId" className={inputClass}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          </Field>
          <Field label="Location">
            <select name="locationId" className={inputClass}><option value="">—</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Employment type">
            <select name="employmentType" className={inputClass}>
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contract">Contract</option>
              <option value="intern">Intern</option>
            </select>
          </Field>
          <Field label="Workplace">
            <select name="workplaceType" className={inputClass} defaultValue="hybrid">
              <option value="onsite">On-site</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
            </select>
          </Field>
          <Field label="Salary min (CAD)">
            <input name="compMin" type="number" step="1000" className={inputClass} />
          </Field>
          <Field label="Salary max (CAD)">
            <input name="compMax" type="number" step="1000" className={inputClass} />
          </Field>
        </div>
        <Field label="Description" hint="Markdown supported (## headings, - bullets, **bold**). Shown on the career site.">
          <textarea name="description" rows={8} className={inputClass} />
        </Field>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="font-semibold">Hiring team & openings</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Hiring manager">
            <select name="hiringManagerId" className={inputClass}><option value="">—</option>{hms.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </Field>
          <Field label="Recruiter">
            <select name="recruiterId" className={inputClass}><option value="">Me</option>{recruiters.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </Field>
          <Field label="Coordinator">
            <select name="coordinatorId" className={inputClass}><option value="">—</option>{coordinators.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Number of openings">
            <input name="openings" type="number" min={1} defaultValue={1} className={inputClass} />
          </Field>
          <Field label="Status">
            <select name="status" className={inputClass}>
              <option value="draft">Draft</option>
              <option value="open">Open (sends for approval if a chain applies)</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 self-end pb-2">
            <input type="checkbox" name="confidential" /> Confidential job
          </label>
        </div>
      </section>

      <div className="flex justify-end">
        <Button variant="primary" disabled={pending}>{pending ? "Creating…" : "Create job"}</Button>
      </div>
    </form>
  );
}
