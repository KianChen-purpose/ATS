import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Video } from "lucide-react";
import { getFeedbackPage } from "@/server/services/feedback";
import { requireActor } from "@/lib/session";
import { ScorecardForm } from "@/components/scheduling/scorecard-form";
import { Card } from "@/components/ui/card";
import { fmt, RECOMMENDATION_LABELS } from "@/lib/utils";

export const metadata = { title: "Submit feedback" };

const STAGE_KITS: Record<string, string[]> = {
  screen: ["Walk me through your background and why this role.", "What are you looking for in your next move?", "Compensation expectations and timing?", "Work authorization and location preferences?"],
  interview: ["Tell me about a project you're most proud of. What was your specific contribution?", "Describe a time you disagreed with a stakeholder. How did you resolve it?", "How would you approach the first 90 days in this role?", "What questions do you have for us?"],
};

export default async function FeedbackPage(props: PageProps<"/interviews/[id]/feedback">) {
  const user = await requireActor();
  const { id } = await props.params;
  const data = await getFeedbackPage(user, id);
  if (!data) notFound();
  const { interview: iv, mine } = data;
  const c = iv.application.candidate;
  const attributes = iv.feedbackForm?.attributes ?? [];
  const kit = STAGE_KITS[iv.stage?.type ?? "interview"] ?? STAGE_KITS.interview;

  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-6 py-6 lg:grid-cols-[1fr_300px]">
      <div>
        <Link href={`/candidates/${c.id}`} className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
          <ChevronLeft size={14} /> {c.firstName} {c.lastName}
        </Link>
        <h1 className="text-lg font-semibold">{iv.stage?.name ?? "Interview"} feedback</h1>
        <p className="mb-5 text-zinc-500">
          {c.firstName} {c.lastName} · {iv.application.job.title} · {fmt(iv.startAt, "EEE MMM d, h:mm a")}
        </p>
        {mine ? (
          <Card className="p-4">
            <div className="font-medium">You submitted feedback {fmt(mine.submittedAt, "MMM d 'at' h:mm a")}</div>
            <div className="mt-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${RECOMMENDATION_LABELS[mine.overall].className}`}>{RECOMMENDATION_LABELS[mine.overall].label}</span>
            </div>
            <p className="mt-2 text-zinc-700">{mine.notes}</p>
          </Card>
        ) : (
          <ScorecardForm interviewId={iv.id} attributes={attributes} />
        )}
      </div>
      <aside className="space-y-4">
        <Card className="p-4">
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Interview kit</div>
          <ul className="mt-2 list-disc space-y-1.5 pl-4 text-zinc-700">
            {kit.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Panel</div>
          <ul className="mt-2 space-y-1">
            {iv.interviewers.map((i) => (
              <li key={i.userId}>{i.user.name}</li>
            ))}
          </ul>
          {iv.meetingUrl && (
            <a href={iv.meetingUrl} target="_blank" className="mt-3 inline-flex items-center gap-1 rounded-md bg-teams px-2 py-1 text-xs font-medium text-white">
              <Video size={12} /> Teams meeting
            </a>
          )}
        </Card>
        {c.resumeText && (
          <Card className="p-4">
            <div className="text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Resume</div>
            <pre className="mt-2 max-h-80 overflow-y-auto font-sans text-xs whitespace-pre-wrap text-zinc-600">{c.resumeText}</pre>
          </Card>
        )}
      </aside>
    </div>
  );
}
