"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function SnapshotDatePicker({ value, max }: { value: string; max: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[13px] font-medium text-zinc-700">
      Pipeline as of
      <input
        type="date"
        value={value}
        max={max}
        aria-busy={pending}
        className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100"
        onChange={(e) => {
          if (!e.target.value) return;
          const p = new URLSearchParams(params.toString());
          p.set("asOf", e.target.value);
          start(() => router.push(`${pathname}?${p.toString()}`));
        }}
      />
    </label>
  );
}
