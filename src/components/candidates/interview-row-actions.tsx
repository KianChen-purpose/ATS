"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, MoreHorizontal } from "lucide-react";
import { cancelInterview, sendFeedbackReminders } from "@/server/actions/scheduling";

export function InterviewRowActions({
  interviewId,
  candidateId,
  applicationId,
  upcoming,
  canManage,
  canSubmitFeedback,
  missingFeedback,
}: {
  interviewId: string;
  candidateId: string;
  applicationId: string;
  upcoming: boolean;
  canManage: boolean;
  canSubmitFeedback: boolean;
  missingFeedback: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
      }
    });

  return (
    <div className="flex items-center gap-1">
      {canSubmitFeedback && (
        <Link href={`/interviews/${interviewId}/feedback`} className="rounded-md bg-accent-600 px-2 py-1 text-xs font-medium text-white hover:bg-accent-700">
          Submit feedback
        </Link>
      )}
      {canManage && !upcoming && missingFeedback && (
        <button disabled={pending} onClick={() => run(async () => alert(`Sent ${(await sendFeedbackReminders([interviewId])).sent} Teams reminder(s).`))} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" title="Remind interviewers in Teams">
          <Bell size={14} />
        </button>
      )}
      {canManage && upcoming && (
        <div className="relative">
          <button onClick={() => setOpen((o) => !o)} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Interview actions">
            <MoreHorizontal size={14} />
          </button>
          {open && (
            <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg" onMouseLeave={() => setOpen(false)}>
              <Link href={`/candidates/${candidateId}/schedule?app=${applicationId}&replace=${interviewId}`} className="block rounded-md px-2 py-1.5 hover:bg-zinc-50">
                Reschedule
              </Link>
              <button
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  if (confirm("Cancel this interview? The Outlook event will be cancelled and the candidate emailed.")) run(() => cancelInterview(interviewId, true));
                }}
                className="block w-full rounded-md px-2 py-1.5 text-left text-red-700 hover:bg-red-50"
              >
                Cancel interview
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
