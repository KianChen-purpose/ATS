import { Check, Clock, Minus, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { cn, fmt } from "@/lib/utils";

type Step = { id: string; position: number; status: "pending" | "approved" | "rejected" | "skipped"; comment: string | null; decidedAt: Date | null; approver: { name: string } };

const ICON = {
  approved: { Icon: Check, cls: "bg-emerald-600 text-white", label: "Approved" },
  rejected: { Icon: X, cls: "bg-red-600 text-white", label: "Rejected" },
  pending: { Icon: Clock, cls: "bg-zinc-100 text-zinc-600", label: "Waiting" },
  skipped: { Icon: Minus, cls: "bg-zinc-100 text-zinc-500", label: "Skipped" },
} as const;

/** Ordered list of approval steps with each approver's decision. */
export function ApprovalSteps({ steps, timezone }: { steps: Step[]; timezone?: string }) {
  const current = steps.find((st) => st.status === "pending")?.id;
  return (
    <ol className="space-y-2">
      {steps.map((st) => {
        const { Icon, cls, label } = ICON[st.status];
        return (
          <li key={st.id} className="flex items-start gap-2.5">
            <span className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full", cls)} aria-hidden>
              <Icon size={12} strokeWidth={2.5} />
            </span>
            <Avatar name={st.approver.name} size={22} />
            <div className="min-w-0">
              <div className="font-medium">
                {st.approver.name}
                <span className="ml-1.5 text-xs font-normal text-zinc-500">
                  {st.id === current ? "Up next" : label}
                  {st.decidedAt && ` · ${fmt(st.decidedAt, "MMM d, h:mm a", timezone)}`}
                </span>
              </div>
              {st.comment && <p className="mt-0.5 text-xs text-zinc-600">“{st.comment}”</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
