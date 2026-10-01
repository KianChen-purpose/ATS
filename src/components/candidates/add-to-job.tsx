"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { addCandidateToJob } from "@/server/actions/applications";

export function AddToJob({ candidateId, jobs, existingJobIds }: { candidateId: string; jobs: { id: string; title: string; brand: string }[]; existingJobIds: string[] }) {
  const [open, setOpen] = useState(false);
  const available = jobs.filter((j) => !existingJobIds.includes(j.id));
  const [jobId, setJobId] = useState(available[0]?.id ?? "");
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} disabled={!available.length}>
        <Plus size={13} /> Add to job
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add to job"
        footer={
          <Button
            variant="primary"
            disabled={pending || !jobId}
            onClick={() =>
              start(async () => {
                try {
                  await addCandidateToJob(candidateId, jobId);
                  setOpen(false);
                  router.refresh();
                } catch (e) {
                  alert((e as Error).message);
                }
              })
            }
          >
            Add
          </Button>
        }
      >
        <label className={labelClass}>Job</label>
        <select className={inputClass} value={jobId} onChange={(e) => setJobId(e.target.value)}>
          {available.map((j) => (
            <option key={j.id} value={j.id}>{j.title} — {j.brand}</option>
          ))}
        </select>
      </Modal>
    </>
  );
}
