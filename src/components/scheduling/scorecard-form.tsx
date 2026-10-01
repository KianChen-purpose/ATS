"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { inputClass } from "@/components/ui/modal";
import { cn } from "@/lib/utils";
import { submitScorecard } from "@/server/actions/feedback";

const RATING_LABELS = ["", "Strong no", "No", "Yes", "Strong yes"];
const OVERALL = [
  { key: "strong_no", label: "Strong No", cls: "border-red-300 bg-red-50 text-red-800" },
  { key: "no", label: "No", cls: "border-orange-300 bg-orange-50 text-orange-800" },
  { key: "yes", label: "Yes", cls: "border-green-300 bg-green-50 text-green-800" },
  { key: "strong_yes", label: "Strong Yes", cls: "border-emerald-400 bg-emerald-50 text-emerald-800" },
] as const;

export function ScorecardForm({ interviewId, attributes }: { interviewId: string; attributes: { key: string; label: string; description?: string }[] }) {
  const router = useRouter();
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [overall, setOverall] = useState<(typeof OVERALL)[number]["key"] | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const complete = overall && notes.trim().length >= 10 && attributes.every((a) => ratings[a.key]);

  const submit = () =>
    start(async () => {
      setError(null);
      try {
        const { candidateId } = await submitScorecard({ interviewId, overall: overall!, ratings, notes });
        router.push(`/candidates/${candidateId}`);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <div className="space-y-5">
      {attributes.map((a) => (
        <div key={a.key} className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="font-medium">{a.label}</div>
          {a.description && <div className="mt-0.5 text-xs text-zinc-500">{a.description}</div>}
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setRatings((r) => ({ ...r, [a.key]: n }))}
                className={cn(
                  "rounded-md border px-2 py-1.5 text-xs font-medium transition-colors",
                  ratings[a.key] === n ? "border-accent-500 bg-accent-50 text-accent-700 ring-2 ring-accent-100" : "border-zinc-200 text-zinc-600 hover:bg-zinc-50",
                )}
              >
                {n} · {RATING_LABELS[n]}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="font-medium">Notes</div>
        <div className="mt-0.5 text-xs text-zinc-500">Evidence for your ratings: what did they say or do? Avoid comments on age, family, accent or other protected characteristics.</div>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={7} className={`${inputClass} mt-2`} />
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-4">
        <div className="font-medium">Overall recommendation</div>
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {OVERALL.map((o) => (
            <button key={o.key} type="button" onClick={() => setOverall(o.key)} className={cn("rounded-md border px-3 py-2 font-medium", overall === o.key ? `${o.cls} ring-2 ring-offset-1` : "border-zinc-200 text-zinc-600 hover:bg-zinc-50")}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
      <div className="flex items-center justify-end gap-3">
        {!complete && <span className="text-xs text-zinc-500">Rate every attribute, add notes and pick an overall recommendation.</span>}
        <Button variant="primary" disabled={!complete || pending} onClick={submit}>{pending ? "Submitting…" : "Submit feedback"}</Button>
      </div>
    </div>
  );
}
