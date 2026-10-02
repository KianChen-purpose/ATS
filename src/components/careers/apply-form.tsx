"use client";

import { useActionState, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { applyToJob, type ApplyState } from "@/server/actions/careers";
import { t, type CareerLocale } from "@/lib/i18n/careers";

type Question = { id: string; kind: "short_text" | "long_text" | "yes_no" | "single_select"; labelEn: string; labelFr: string; options: { value: string; en: string; fr: string }[]; required: boolean };

const input = "mt-1 block w-full rounded-md border border-zinc-400 bg-white px-3 py-2 text-base focus:border-black focus:outline-none";
const labelCls = "block text-sm font-medium";

/** Public application form. Labels are explicit, errors are announced, and it works with the keyboard. */
export function ApplyForm({ jobId, jobTitle, brand, locale, questions }: { jobId: string; jobTitle: string; brand: string; locale: CareerLocale; questions: Question[] }) {
  const tr = t(locale);
  const f = tr.form;
  const [state, action, pending] = useActionState<ApplyState, FormData>(applyToJob, { status: "idle" });
  const [started] = useState(() => Date.now());
  const fr = locale === "fr-CA";
  const req = <span className="text-zinc-700"> ({f.required})</span>;
  const invalid = (name: string) => state.status === "error" && state.field === name;

  if (state.status === "done") {
    return (
      <div role="status" className="rounded-lg border border-zinc-300 bg-white p-6">
        <CheckCircle2 size={28} aria-hidden />
        <h2 className="mt-2 text-2xl">{f.doneTitle}</h2>
        <p className="mt-2 text-zinc-800">{f.doneBody(jobTitle, brand)}</p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5 rounded-lg border border-zinc-300 bg-white p-6" noValidate={false}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="lang" value={fr ? "fr" : "en"} />
      <input type="hidden" name="started" value={started} />
      {/* Honeypot: hidden from people and assistive tech; bots fill it. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      {state.status === "error" && (
        <p role="alert" className="rounded-md border border-red-700 bg-red-50 px-3 py-2 text-red-900">
          {f.errors[state.error as keyof typeof f.errors] ?? f.errors.invalid}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className={labelCls}>
          {f.firstName}{req}
          <input name="firstName" required autoComplete="given-name" className={input} aria-invalid={invalid("firstName")} />
        </label>
        <label className={labelCls}>
          {f.lastName}{req}
          <input name="lastName" required autoComplete="family-name" className={input} aria-invalid={invalid("lastName")} />
        </label>
        <label className={labelCls}>
          {f.email}{req}
          <input name="email" type="email" required autoComplete="email" className={input} aria-invalid={invalid("email")} />
        </label>
        <label className={labelCls}>
          {f.phone}
          <input name="phone" type="tel" autoComplete="tel" className={input} />
        </label>
        <label className={labelCls}>
          {f.location}
          <input name="location" autoComplete="address-level2" className={input} />
        </label>
        <label className={labelCls}>
          {f.linkedin}
          <input name="linkedinUrl" type="url" inputMode="url" className={input} aria-invalid={invalid("linkedinUrl")} />
        </label>
      </div>

      <label className={labelCls}>
        {f.resume}
        <input name="resume" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="mt-1 block w-full text-sm" />
      </label>

      {questions.length > 0 && (
        <fieldset className="space-y-4">
          <legend className="text-lg">{f.questions}</legend>
          {questions.map((q) => {
            const label = fr ? q.labelFr : q.labelEn;
            const name = `q_${q.id}`;
            if (q.kind === "yes_no") {
              return (
                <fieldset key={q.id} aria-invalid={invalid(q.id)}>
                  <legend className={labelCls}>{label}{q.required && req}</legend>
                  <div className="mt-1 flex gap-4">
                    {(["yes", "no"] as const).map((v) => (
                      <label key={v} className="inline-flex items-center gap-2">
                        <input type="radio" name={name} value={v} required={q.required} className="size-4" /> {v === "yes" ? f.yes : f.no}
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            if (q.kind === "single_select") {
              return (
                <label key={q.id} className={labelCls}>
                  {label}{q.required && req}
                  <select name={name} required={q.required} defaultValue="" className={input} aria-invalid={invalid(q.id)}>
                    <option value="" disabled>{f.choose}</option>
                    {q.options.map((o) => <option key={o.value} value={o.value}>{fr ? o.fr : o.en}</option>)}
                  </select>
                </label>
              );
            }
            return (
              <label key={q.id} className={labelCls}>
                {label}{q.required && req}
                {q.kind === "long_text" ? (
                  <textarea name={name} required={q.required} rows={4} maxLength={5000} className={input} aria-invalid={invalid(q.id)} />
                ) : (
                  <input name={name} required={q.required} maxLength={500} className={input} aria-invalid={invalid(q.id)} />
                )}
              </label>
            );
          })}
        </fieldset>
      )}

      <div className="space-y-3 border-t border-zinc-300 pt-4">
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consentProcessing" required className="mt-1 size-4 shrink-0" aria-invalid={state.status === "error" && state.error === "consent_required"} />
          <span>{f.consentProcessing(brand)}{req}</span>
        </label>
        <label className="flex items-start gap-3">
          <input type="checkbox" name="consentTalentPool" className="mt-1 size-4 shrink-0" />
          <span>{f.consentTalentPool}</span>
        </label>
        <p className="text-sm text-zinc-700">{tr.privacy}</p>
      </div>

      <button disabled={pending} className="inline-flex h-11 items-center rounded-md bg-black px-5 font-medium text-[var(--pats-ivory)] hover:bg-zinc-800 disabled:opacity-60">
        {pending ? f.submitting : f.submit}
      </button>
    </form>
  );
}
