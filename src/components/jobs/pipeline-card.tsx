import { CalendarClock } from "lucide-react";
import { Avatar, candidateColor } from "@/components/ui/avatar";
import { cn, daysSince, fmt } from "@/lib/utils";
import type { PipelineApp } from "@/server/services/jobs";

export function FeedbackDots({ feedback }: { feedback: Record<string, number> }) {
  const order = [
    ["strong_yes", "bg-emerald-600"],
    ["yes", "bg-emerald-400"],
    ["no", "bg-orange-400"],
    ["strong_no", "bg-red-600"],
  ] as const;
  const total = Object.values(feedback).reduce((a, b) => a + b, 0);
  if (!total) return null;
  return (
    <span className="inline-flex items-center gap-0.5" title={order.map(([k]) => `${k.replace("_", " ")}: ${feedback[k] ?? 0}`).join(", ")}>
      {order.flatMap(([k, cls]) => Array.from({ length: feedback[k] ?? 0 }, (_, i) => <span key={k + i} className={cn("h-2 w-2 rounded-full", cls)} />))}
    </span>
  );
}

export function PipelineCard({ app, selected }: { app: PipelineApp; selected?: boolean }) {
  const name = `${app.firstName} ${app.lastName}`;
  const days = daysSince(app.stageEnteredAt);
  return (
    <div
      className={cn(
        "rounded-md border bg-white px-2.5 py-2 shadow-xs transition-colors",
        selected ? "border-accent-500 ring-2 ring-accent-100" : "border-zinc-200 hover:border-zinc-300",
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={name} color={candidateColor(app.firstName + app.lastName)} size={22} />
        <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">{name}</span>
        <FeedbackDots feedback={app.feedback} />
      </div>
      <div className="mt-1 truncate text-xs text-zinc-500">{[app.currentTitle, app.currentCompany].filter(Boolean).join(" · ")}</div>
      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
        <span className={cn(days > 14 && app.status === "active" && "font-medium text-amber-700")}>{days}d in stage</span>
        {app.source && <span className="truncate">· {app.source}</span>}
      </div>
      {app.nextInterview && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-[11px] font-medium text-sky-700">
          <CalendarClock size={11} /> {fmt(app.nextInterview, "EEE MMM d, h:mm a")}
        </div>
      )}
    </div>
  );
}
