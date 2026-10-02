"use client";

import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { uploadOfferLetterTemplate } from "@/server/actions/offer-letters";

export function TemplateUpload({ brands }: { brands: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(uploadOfferLetterTemplate, null);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state && "ok" in state) form.current?.reset();
  }, [state]);
  return (
    <form ref={form} action={action} className="grid gap-3 sm:grid-cols-[2fr_1.5fr_1fr_2fr_auto] sm:items-end">
      <div>
        <label className={labelClass} htmlFor="t-name">Name</label>
        <input id="t-name" name="name" required className={inputClass} placeholder="e.g. Steadyhand offer letter" />
      </div>
      <div>
        <label className={labelClass} htmlFor="t-brand">Brand</label>
        <select id="t-brand" name="brandId" className={inputClass}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="t-locale">Language</label>
        <select id="t-locale" name="locale" className={inputClass}>
          <option value="en">English</option>
          <option value="fr-CA">Français (CA)</option>
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="t-file">Word file (.docx)</label>
        <input id="t-file" name="file" type="file" required accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="block w-full text-xs" />
      </div>
      <Button variant="primary" disabled={pending}>{pending ? "Uploading…" : "Upload"}</Button>
      {state && "error" in state && <p className="text-xs text-red-700 sm:col-span-5">{state.error}</p>}
    </form>
  );
}
