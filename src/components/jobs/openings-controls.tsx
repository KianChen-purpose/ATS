"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { addOpenings, closeOpening } from "@/server/actions/jobs";

export function AddOpeningsButton({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [reason, setReason] = useState<"new_headcount" | "backfill">("new_headcount");
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus size={13} /> Add openings
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add openings"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  setError(null);
                  try {
                    await addOpenings({ jobId, count, reason, targetStartDate: target || null });
                    setOpen(false);
                    router.refresh();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                })
              }
            >
              Add {count} opening{count === 1 ? "" : "s"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className={labelClass} htmlFor="op-count">How many</label>
            <input id="op-count" type="number" min={1} max={50} className={inputClass} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value) || 1))} />
          </div>
          <div>
            <label className={labelClass} htmlFor="op-reason">Reason</label>
            <select id="op-reason" className={inputClass} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>
              <option value="new_headcount">New headcount</option>
              <option value="backfill">Backfill</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="op-start">Target start</label>
            <input id="op-start" type="date" className={inputClass} value={target} onChange={(e) => setTarget(e.target.value)} />
          </div>
        </div>
        {error && <div className="mt-3 text-xs text-red-700">{error}</div>}
      </Modal>
    </>
  );
}

export function CloseOpeningButton({ openingId, code }: { openingId: string; code: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`Close opening ${code}? It will no longer count toward open headcount.`)) return;
        start(async () => {
          await closeOpening(openingId);
          router.refresh();
        });
      }}
      className="text-xs text-zinc-500 hover:text-zinc-900 hover:underline"
    >
      Close
    </button>
  );
}
