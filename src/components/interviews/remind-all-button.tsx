"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { sendFeedbackReminders } from "@/server/actions/scheduling";
import { buttonClass } from "@/components/ui/button";

/** Sends a Teams nudge to every interviewer still owing feedback on the listed interviews. */
export function RemindAllButton({ interviewIds }: { interviewIds: string[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending || interviewIds.length === 0}
      className={buttonClass("secondary")}
      onClick={() =>
        start(async () => {
          try {
            const { sent } = await sendFeedbackReminders(interviewIds);
            alert(`Sent ${sent} Teams reminder(s).`);
            router.refresh();
          } catch (e) {
            alert((e as Error).message);
          }
        })
      }
    >
      <Bell size={14} /> {pending ? "Sending…" : "Remind all in Teams"}
    </button>
  );
}
