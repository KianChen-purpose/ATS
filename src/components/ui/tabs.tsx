"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/** Client-side tabs over server-rendered panels. */
export function Tabs({ tabs, initial }: { tabs: { key: string; label: string; count?: number; content: React.ReactNode }[]; initial?: string }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.key);
  return (
    <div>
      <div className="flex gap-5 border-b border-zinc-200 px-5">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 py-2 font-medium",
              active === t.key ? "border-accent-600 text-zinc-900" : "border-transparent text-zinc-500 hover:text-zinc-800",
            )}
          >
            {t.label}
            {t.count != null && t.count > 0 && <span className="rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">{t.count}</span>}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.key} hidden={t.key !== active}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
