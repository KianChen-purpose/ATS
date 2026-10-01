import Link from "next/link";
import { cn } from "@/lib/utils";

/** Underline tabs that set a search param, Ashby-style. */
export function FilterTabs({
  tabs,
  active,
  hrefFor,
}: {
  tabs: { key: string; label: string; count?: number }[];
  active: string;
  hrefFor: (key: string) => string;
}) {
  return (
    <div className="-mb-px flex gap-5">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={hrefFor(t.key)}
          className={cn(
            "flex items-center gap-1.5 border-b-2 pb-2 font-medium transition-colors",
            active === t.key ? "border-accent-600 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800",
          )}
        >
          {t.label}
          {t.count != null && <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">{t.count}</span>}
        </Link>
      ))}
    </div>
  );
}
