import { Badge } from "@/components/ui/badge";
import { ApprovalDecision } from "@/components/approvals/approval-decision";
import { ApprovalSteps } from "@/components/approvals/approval-steps";
import { fmt, money } from "@/lib/utils";
import { OfferActions } from "./offer-actions";
import { OfferForm } from "./offer-form";
import { PreviewLetterButton } from "./preview-letter-button";
import { FileText } from "lucide-react";

const STATUS = {
  draft: { tone: "neutral", label: "Draft" },
  pending_approval: { tone: "amber", label: "Pending approval" },
  approved: { tone: "blue", label: "Approved" },
  sent: { tone: "accent", label: "Sent" },
  accepted: { tone: "green", label: "Accepted" },
  declined: { tone: "red", label: "Declined" },
  withdrawn: { tone: "neutral", label: "Withdrawn" },
} as const;

export function OfferStatusBadge({ status }: { status: keyof typeof STATUS }) {
  return <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>;
}

type Offer = {
  id: string;
  status: keyof typeof STATUS;
  baseSalary: number;
  bonusPercent: number | null;
  signOnBonus: number | null;
  equity: string | null;
  currency: string;
  startDate: string | null;
  openingId: string | null;
  notes: string | null;
  declineReason: string | null;
  letterFileId: string | null;
  approval: {
    id: string;
    status: string;
    steps: { id: string; position: number; status: "pending" | "approved" | "rejected" | "skipped"; comment: string | null; decidedAt: Date | null; approverId: string; approver: { name: string } }[];
  } | null;
};

export function OfferCard({
  offer: o,
  jobTitle,
  band,
  openings,
  canManage,
  viewerId,
  timezone,
}: {
  offer: Offer;
  jobTitle: string;
  band: { min: number | null; max: number | null; currency: string };
  openings: { id: string; code: string; status: string }[];
  canManage: boolean;
  viewerId: string;
  timezone: string;
}) {
  const yourTurn = o.approval?.status === "pending" && o.approval.steps.find((st) => st.status === "pending")?.approverId === viewerId;
  const openingCode = openings.find((op) => op.id === o.openingId)?.code;
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium">{jobTitle}</div>
        <OfferStatusBadge status={o.status} />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div><dt className="text-xs text-zinc-500">Base</dt><dd>{money(o.baseSalary, o.currency)}</dd></div>
        <div><dt className="text-xs text-zinc-500">Target bonus</dt><dd>{o.bonusPercent != null ? `${o.bonusPercent}%` : "—"}</dd></div>
        <div><dt className="text-xs text-zinc-500">Sign-on</dt><dd>{money(o.signOnBonus, o.currency)}</dd></div>
        <div><dt className="text-xs text-zinc-500">Start</dt><dd>{o.startDate ? fmt(o.startDate + "T12:00:00Z", "MMM d, yyyy") : "—"}</dd></div>
        <div><dt className="text-xs text-zinc-500">Opening</dt><dd>{openingCode ?? "Next open"}</dd></div>
        {o.equity && <div className="col-span-2 sm:col-span-3"><dt className="text-xs text-zinc-500">Equity / LTIP</dt><dd>{o.equity}</dd></div>}
      </dl>
      {o.letterFileId && (
        <a href={`/api/files/${o.letterFileId}`} className="mt-2 inline-flex items-center gap-1 text-xs text-accent-700 hover:underline">
          <FileText size={12} aria-hidden /> Offer letter (.docx)
        </a>
      )}
      {o.declineReason && <p className="mt-2 text-xs text-zinc-600">Decline reason: {o.declineReason}</p>}
      {o.notes && canManage && <p className="mt-2 text-xs text-zinc-500">Notes: {o.notes}</p>}

      {o.approval && o.approval.status !== "cancelled" && (
        <div className="mt-3 border-t border-zinc-100 pt-3">
          <div className="mb-2 text-[11px] font-semibold tracking-wide text-zinc-500 uppercase">Approvals</div>
          <ApprovalSteps steps={o.approval.steps} timezone={timezone} />
        </div>
      )}

      {(canManage || yourTurn) && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3">
          {yourTurn && <ApprovalDecision requestId={o.approval!.id} size="sm" />}
          {canManage && o.status === "draft" && (
            <OfferForm
              offerId={o.id}
              label="Edit"
              jobTitle={jobTitle}
              band={band}
              openings={openings.filter((op) => op.status === "open")}
              initial={{ baseSalary: o.baseSalary, bonusPercent: o.bonusPercent, signOnBonus: o.signOnBonus, equity: o.equity, currency: o.currency === "USD" ? "USD" : "CAD", startDate: o.startDate, openingId: o.openingId, notes: o.notes }}
            />
          )}
          {canManage && o.status === "approved" && <PreviewLetterButton offerId={o.id} />}
          {canManage && <OfferActions offerId={o.id} status={o.status} />}
        </div>
      )}
    </div>
  );
}
