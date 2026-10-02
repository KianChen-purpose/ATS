import { Avatar } from "@/components/ui/avatar";
import { cn, RECOMMENDATION_LABELS } from "@/lib/utils";

type Scorecard = {
  id: string;
  overall: string;
  ratings: Record<string, number>;
  author: { name: string };
  interview: { title: string } | null;
};

const SCORE_CLASS: Record<number, string> = {
  1: "bg-red-100 text-red-800",
  2: "bg-orange-50 text-orange-700",
  3: "bg-green-50 text-green-700",
  4: "bg-emerald-100 text-emerald-800",
};

/** Ashby-style debrief: interviewers × attributes with overall recommendation. */
export function DebriefMatrix({ scorecards, attributeLabels, jobTitle }: { scorecards: Scorecard[]; attributeLabels: Record<string, string>; jobTitle: string }) {
  if (scorecards.length === 0) return null;
  const keys = [...new Set(scorecards.flatMap((s) => Object.keys(s.ratings)))];
  const avg = (k: string) => {
    const vals = scorecards.map((s) => s.ratings[k]).filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  const tally = scorecards.reduce<Record<string, number>>((acc, s) => ((acc[s.overall] = (acc[s.overall] ?? 0) + 1), acc), {});

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50/60 px-3 py-2">
        <span className="font-semibold">Debrief · {jobTitle}</span>
        <div className="flex gap-1.5">
          {(["strong_yes", "yes", "no", "strong_no"] as const).map((k) =>
            tally[k] ? (
              <span key={k} className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RECOMMENDATION_LABELS[k].className}`}>
                {tally[k]} {RECOMMENDATION_LABELS[k].label}
              </span>
            ) : null,
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] font-medium text-zinc-500">
              <th className="px-3 py-2">Interviewer</th>
              {keys.map((k) => (
                <th key={k} className="px-2 py-2 text-center">{attributeLabels[k] ?? k.replace(/_/g, " ")}</th>
              ))}
              <th className="px-3 py-2 text-right">Overall</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {scorecards.map((s) => (
              <tr key={s.id}>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={s.author.name} size={20} />
                    <div className="min-w-0">
                      <div className="truncate">{s.author.name}</div>
                      <div className="truncate text-[11px] text-zinc-500">{s.interview?.title.split(" – ")[0]}</div>
                    </div>
                  </div>
                </td>
                {keys.map((k) => (
                  <td key={k} className="px-2 py-1.5 text-center">
                    {s.ratings[k] != null ? <span className={cn("inline-block w-6 rounded py-0.5 text-[11px] font-semibold", SCORE_CLASS[s.ratings[k]])}>{s.ratings[k]}</span> : "—"}
                  </td>
                ))}
                <td className="px-3 py-1.5 text-right">
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RECOMMENDATION_LABELS[s.overall].className}`}>{RECOMMENDATION_LABELS[s.overall].label}</span>
                </td>
              </tr>
            ))}
            <tr className="bg-zinc-50/60 font-medium">
              <td className="px-3 py-1.5 text-zinc-600">Average</td>
              {keys.map((k) => (
                <td key={k} className="px-2 py-1.5 text-center tabular-nums text-zinc-700">{avg(k)?.toFixed(1) ?? "—"}</td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
