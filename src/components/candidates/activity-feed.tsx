import {
  ArrowRight,
  Archive,
  ArchiveRestore,
  CalendarPlus,
  CalendarX,
  ClipboardCheck,
  FileSignature,
  Mail,
  PartyPopper,
  StickyNote,
  UserPlus,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { RECOMMENDATION_LABELS, timeAgo, fmt } from "@/lib/utils";
import type { CandidateProfile } from "@/server/services/candidates";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  note: StickyNote,
  email: Mail,
  stage_change: ArrowRight,
  application_created: UserPlus,
  archived: Archive,
  unarchived: ArchiveRestore,
  interview_scheduled: CalendarPlus,
  interview_cancelled: CalendarX,
  feedback_submitted: ClipboardCheck,
  offer_created: FileSignature,
  offer_updated: FileSignature,
  hired: PartyPopper,
};

export function ActivityFeed({ activities, jobTitles }: { activities: CandidateProfile["activities"]; jobTitles: Record<string, string> }) {
  return (
    <ol className="relative space-y-3">
      {activities.map((a) => {
        const Icon = ICONS[a.type] ?? StickyNote;
        const isNote = a.type === "note";
        const overall = a.type === "feedback_submitted" ? (a.metadata as { overall?: string }).overall : undefined;
        return (
          <li key={a.id} className="flex gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
              <Icon size={12} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-1.5 text-[12px] text-zinc-500">
                {a.actor ? <span className="font-medium text-zinc-800">{a.actor.name}</span> : <span className="font-medium text-zinc-800">Candidate</span>}
                {!isNote && <span className="text-zinc-700">{a.body}</span>}
                {overall && (
                  <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RECOMMENDATION_LABELS[overall]?.className}`}>
                    {RECOMMENDATION_LABELS[overall]?.label}
                  </span>
                )}
                <span title={fmt(a.createdAt, "PPpp")}>· {timeAgo(a.createdAt)}</span>
                {a.applicationId && jobTitles[a.applicationId] && <span className="truncate">· {jobTitles[a.applicationId]}</span>}
              </div>
              {isNote && <div className="mt-1 rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 whitespace-pre-wrap text-zinc-800">{highlightMentions(a.body ?? "")}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function highlightMentions(text: string) {
  return text.split(/(@[A-Z][\p{L}'-]+ [A-Z][\p{L}'-]+)/u).map((part, i) =>
    part.startsWith("@") ? (
      <span key={i} className="rounded bg-accent-50 px-0.5 font-medium text-accent-700">{part}</span>
    ) : (
      part
    ),
  );
}

export function PersonChip({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Avatar name={name} size={18} />
      {name}
    </span>
  );
}
