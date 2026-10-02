import { Badge } from "@/components/ui/badge";

const MAP = {
  open: { tone: "green", label: "Open" },
  pending_approval: { tone: "amber", label: "Pending approval" },
  on_hold: { tone: "amber", label: "On hold" },
  draft: { tone: "neutral", label: "Draft" },
  closed: { tone: "neutral", label: "Closed" },
} as const;

export function JobStatusBadge({ status }: { status: keyof typeof MAP }) {
  const m = MAP[status];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
