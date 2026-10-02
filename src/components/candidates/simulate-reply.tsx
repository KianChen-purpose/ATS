"use client";

import { useTransition } from "react";
import { Reply } from "lucide-react";
import { simulateReplyAction } from "@/server/actions/mail";

/** Mock mode only: stands in for a candidate replying in Outlook. */
export function SimulateReply({ emailId, candidateId }: { emailId: string; candidateId: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => simulateReplyAction(emailId, candidateId).then(() => {}))}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 disabled:opacity-50"
      title="Demo: simulate the candidate replying (mock mode)"
    >
      <Reply size={12} /> {pending ? "Replying…" : "Simulate reply"}
    </button>
  );
}
