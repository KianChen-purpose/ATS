"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { createTalentPool } from "@/server/actions/talent-pools";

export function NewPoolForm({ brands }: { brands: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createTalentPool, null);
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-[2fr_2fr_1.5fr_auto] sm:items-end">
      <div><label className={labelClass} htmlFor="p-name">Name</label><input id="p-name" name="name" required className={inputClass} placeholder="e.g. Senior engineers – Toronto" /></div>
      <div><label className={labelClass} htmlFor="p-desc">Description</label><input id="p-desc" name="description" className={inputClass} /></div>
      <div>
        <label className={labelClass} htmlFor="p-brand">Brand</label>
        <select id="p-brand" name="brandId" className={inputClass}>
          <option value="">All brands</option>
          {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </div>
      <Button variant="primary" disabled={pending}>Create pool</Button>
      {state && "error" in state && <p className="text-xs text-red-700 sm:col-span-4">{state.error}</p>}
    </form>
  );
}
