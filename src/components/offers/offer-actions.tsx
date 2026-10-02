"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { recordOfferResponse, returnOfferToDraft, sendOffer, submitOffer, withdrawOffer } from "@/server/actions/offers";

type Status = "draft" | "pending_approval" | "approved" | "sent" | "accepted" | "declined" | "withdrawn";

/** Recruiter actions for an offer, by status. */
export function OfferActions({ offerId, status }: { offerId: string; status: Status }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const router = useRouter();
  const run = (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    start(async () => {
      setError(null);
      try {
        await fn();
        setDeclining(false);
        router.refresh();
      } catch (e) {
        setError((e as Error).message);
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && (
        <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => submitOffer(offerId))}>Submit for approval</Button>
      )}
      {status === "approved" && (
        <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => sendOffer(offerId), "Email the offer to the candidate now?")}>Send offer</Button>
      )}
      {status === "sent" && (
        <>
          <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => recordOfferResponse({ offerId, response: "accepted" }), "Mark the offer accepted? The candidate moves to Hired.")}>
            Mark accepted
          </Button>
          <Button size="sm" disabled={pending} onClick={() => setDeclining(true)}>Mark declined</Button>
        </>
      )}
      {(status === "pending_approval" || status === "approved") && (
        <Button size="sm" disabled={pending} onClick={() => run(() => returnOfferToDraft(offerId), "Move back to draft? Approvals so far are cancelled.")}>Back to draft</Button>
      )}
      {["draft", "pending_approval", "approved", "sent"].includes(status) && (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => withdrawOffer(offerId), "Withdraw this offer?")}>Withdraw</Button>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
      <Modal
        open={declining}
        onClose={() => setDeclining(false)}
        title="Offer declined"
        footer={
          <>
            <Button onClick={() => setDeclining(false)}>Cancel</Button>
            <Button variant="primary" disabled={pending} onClick={() => run(() => recordOfferResponse({ offerId, response: "declined", declineReason: reason }))}>Save</Button>
          </>
        }
      >
        <label className={labelClass} htmlFor="decline-reason">Reason, if the candidate gave one</label>
        <textarea id="decline-reason" className={`${inputClass} h-20 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Accepted a counter-offer" />
      </Modal>
    </div>
  );
}
