"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setJobStatus } from "@/server/actions/jobs";

export function JobStatusMenu({ jobId, status }: { jobId: string; status: "draft" | "open" | "on_hold" | "closed" }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) =>
        start(async () => {
          await setJobStatus(jobId, e.target.value as typeof status);
          router.refresh();
        })
      }
      className="h-8 rounded-md border border-zinc-200 bg-white px-2 font-medium"
      aria-label="Job status"
    >
      <option value="draft">Draft</option>
      <option value="open">Open</option>
      <option value="on_hold">On hold</option>
      <option value="closed">Closed</option>
    </select>
  );
}
