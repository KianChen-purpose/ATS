"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Languages } from "lucide-react";

/** Switches the career site between English and French, keeping the current page and filters. */
export function LanguageToggle({ current, label }: { current: "en" | "fr-CA"; label: string }) {
  const pathname = usePathname();
  const params = new URLSearchParams(useSearchParams());
  params.set("lang", current === "fr-CA" ? "en" : "fr");
  return (
    <Link href={`${pathname}?${params}`} hrefLang={current === "fr-CA" ? "en" : "fr-CA"} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium hover:bg-zinc-100">
      <Languages size={14} aria-hidden /> {label}
    </Link>
  );
}
