"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStatus } from "@/server/actions/jobs";

type Status = "draft" | "pending_approval" | "open" | "on_hold" | "closed";

export function JobStatusMenu({ jobId, status }: { jobId: string; status: Status }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="flex items-center gap-2">
      {error && <span className="max-w-60 text-xs text-red-700">{error}</span>}
      <select
        value={status}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            setError(null);
            try {
              await setJobStatus(jobId, e.target.value);
              router.refresh();
            } catch (err) {
              setError((err as Error).message);
            }
          })
        }
        className="h-8 rounded-md border border-zinc-200 bg-white px-2 font-medium"
        aria-label="Job status"
      >
        {status === "pending_approval" ? (
          <>
            <option value="pending_approval" disabled>Pending approval</option>
            <option value="draft">Withdraw to draft</option>
          </>
        ) : (
          <>
            <option value="draft">Draft</option>
            <option value="open">Open</option>
            <option value="on_hold">On hold</option>
            <option value="closed">Closed</option>
          </>
        )}
      </select>
    </span>
  );
}
