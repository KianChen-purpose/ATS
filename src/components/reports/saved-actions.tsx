"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { addToDashboardAction, deleteDashboardAction, deleteReportAction, saveDashboardAction } from "@/server/actions/reports";

const selectClass = "rounded-md border border-zinc-200 bg-white px-2 py-1 text-[13px] outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";

export function DeleteButton({ kind, id, name }: { kind: "report" | "dashboard"; id: string; name: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => {
          if (!confirm(`Delete “${name}”? This can't be undone.`)) return;
          start(async () => {
            const r = kind === "report" ? await deleteReportAction(id) : await deleteDashboardAction(id);
            if ("error" in r) return setError(r.error);
            router.push("/reports/saved");
          });
        }}
      >
        <Trash2 size={14} /> Delete
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}

export function AddToDashboard({ reportId, dashboards }: { reportId: string; dashboards: { id: string; name: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  if (dashboards.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      <select
        aria-label="Add to dashboard"
        className={selectClass}
        value=""
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return;
          start(async () => {
            const r = await addToDashboardAction(id, reportId);
            if ("error" in r) return setMsg(r.error);
            router.push(`/reports/dashboards/${id}`);
          });
        }}
      >
        <option value="">Add to dashboard…</option>
        {dashboards.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {msg && <span className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}

/** Reorder or remove a dashboard's tiles (owner only). */
export function TileControls({
  dashboard,
  index,
}: {
  dashboard: { id: string; name: string; description: string | null; visibility: "private" | "people" | "everyone"; shareWith: string[]; reportIds: string[] };
  index: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = (reportIds: string[]) =>
    start(async () => {
      await saveDashboardAction({ id: dashboard.id, name: dashboard.name, description: dashboard.description ?? undefined, visibility: dashboard.visibility, shareWith: dashboard.shareWith, reportIds });
      router.refresh();
    });
  const ids = dashboard.reportIds;
  const move = (d: -1 | 1) => {
    const next = [...ids];
    [next[index], next[index + d]] = [next[index + d], next[index]];
    save(next);
  };
  return (
    <span className="flex items-center gap-0.5 text-zinc-500">
      <button type="button" aria-label="Move up" disabled={pending || index === 0} onClick={() => move(-1)} className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30">
        <ArrowUp size={13} />
      </button>
      <button type="button" aria-label="Move down" disabled={pending || index === ids.length - 1} onClick={() => move(1)} className="rounded p-1 hover:bg-zinc-100 disabled:opacity-30">
        <ArrowDown size={13} />
      </button>
      <button type="button" aria-label="Remove from dashboard" disabled={pending} onClick={() => save(ids.filter((_, i) => i !== index))} className="rounded p-1 hover:bg-zinc-100">
        <X size={13} />
      </button>
    </span>
  );
}
