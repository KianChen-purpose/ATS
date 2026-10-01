"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { updateCandidateTags } from "@/server/actions/applications";

export function TagEditor({ candidateId, tags, editable }: { candidateId: string; tags: string[]; editable: boolean }) {
  const [list, setList] = useState(tags);
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const [, start] = useTransition();
  const save = (next: string[]) => {
    setList(next);
    start(() => updateCandidateTags(candidateId, next));
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {list.map((t) => (
        <span key={t} className="group inline-flex items-center gap-1 rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700">
          {t}
          {editable && (
            <button onClick={() => save(list.filter((x) => x !== t))} className="hidden text-zinc-400 group-hover:inline hover:text-zinc-700" aria-label={`Remove ${t}`}>
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {editable &&
        (adding ? (
          <input
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setAdding(false)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                save([...list, value.trim()]);
                setValue("");
              }
              if (e.key === "Escape") setAdding(false);
            }}
            className="h-5 w-24 rounded border border-accent-500 px-1 text-[11px] outline-none"
          />
        ) : (
          <button onClick={() => setAdding(true)} className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
            <Plus size={10} /> Tag
          </button>
        ))}
    </div>
  );
}
