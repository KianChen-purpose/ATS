"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { decideApproval } from "@/server/actions/approvals";

/** Approve / reject buttons for the approver whose turn it is. Rejecting asks for a reason. */
export function ApprovalDecision({ requestId, size = "md" }: { requestId: string; size?: "sm" | "md" }) {
  const [pending, start] = useTransition();
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const run = (decision: "approved" | "rejected") =>
    start(async () => {
      setError(null);
      try {
        await decideApproval(requestId, decision, decision === "rejected" ? comment : undefined);
        setRejecting(false);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });

  return (
    <div className="flex items-center gap-2">
      <Button size={size} variant="primary" disabled={pending} onClick={() => run("approved")}>
        <Check size={14} /> Approve
      </Button>
      <Button size={size} disabled={pending} onClick={() => setRejecting(true)}>
        <X size={14} /> Reject
      </Button>
      {error && !rejecting && <span className="text-xs text-red-700">{error}</span>}
      <Modal
        open={rejecting}
        onClose={() => setRejecting(false)}
        title="Reject approval"
        footer={
          <>
            <Button onClick={() => setRejecting(false)}>Cancel</Button>
            <Button variant="danger" disabled={pending || !comment.trim()} onClick={() => run("rejected")}>Reject</Button>
          </>
        }
      >
        <label className={labelClass} htmlFor="reject-reason">Reason (shared with the requester)</label>
        <textarea id="reject-reason" className={`${inputClass} h-24 py-2`} value={comment} onChange={(e) => setComment(e.target.value)} autoFocus />
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}
      </Modal>
    </div>
  );
}
