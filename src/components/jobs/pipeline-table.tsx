"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Avatar, candidateColor } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, daysSince, fmt, timeAgo } from "@/lib/utils";
import { archiveApplications, moveToStage } from "@/server/actions/applications";
import type { PipelineApp } from "@/server/queries/jobs";
import { FeedbackDots } from "./pipeline-card";

type Stage = { id: string; name: string; type: string; position: number };

export function PipelineTable({
  stages,
  apps,
  canManage,
  archiveReasons,
}: {
  stages: Stage[];
  apps: PipelineApp[];
  canManage: boolean;
  archiveReasons: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [stageFilter, setStageFilter] = useState<string>("");
  const [pending, start] = useTransition();
  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const rows = apps
    .filter((a) => !stageFilter || a.stageId === stageFilter)
    .sort((a, b) => (stageById[b.stageId]?.position ?? 0) - (stageById[a.stageId]?.position ?? 0));
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const bulk = (fn: () => Promise<void>) =>
    start(async () => {
      try {
        await fn();
        setSelected(new Set());
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
      }
    });

  const open = (a: PipelineApp) => {
    const p = new URLSearchParams(params);
    p.set("c", a.candidateId);
    p.set("app", a.id);
    router.push(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <div className="px-6 py-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} className="h-8 rounded-md border border-zinc-200 bg-white px-2">
          <option value="">All stages ({apps.length})</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({apps.filter((a) => a.stageId === s.id).length})
            </option>
          ))}
        </select>
        {canManage && selected.size > 0 && (
          <div className="flex items-center gap-2 rounded-md bg-accent-50 px-2 py-1">
            <span className="text-xs font-medium text-accent-700">{selected.size} selected</span>
            <select
              disabled={pending}
              defaultValue=""
              onChange={(e) => e.target.value && bulk(() => moveToStage([...selected], e.target.value))}
              className="h-7 rounded border border-zinc-200 bg-white px-1.5 text-xs"
            >
              <option value="" disabled>Move to…</option>
              {stages.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <select
              disabled={pending}
              defaultValue=""
              onChange={(e) => e.target.value && bulk(() => archiveApplications({ applicationIds: [...selected], reasonId: e.target.value }))}
              className="h-7 rounded border border-zinc-200 bg-white px-1.5 text-xs"
            >
              <option value="" disabled>Archive as…</option>
              {archiveReasons.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <table className="w-full">
          <thead className="border-b border-zinc-200 bg-zinc-50/60">
            <tr className="text-left text-[11px] font-medium tracking-wide text-zinc-500 uppercase">
              {canManage && (
                <th className="w-8 px-3 py-2">
                  <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" />
                </th>
              )}
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">In stage</th>
              <th className="px-3 py-2">Feedback</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Next interview</th>
              <th className="px-3 py-2 text-right">Applied</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {rows.map((a) => {
              const name = `${a.firstName} ${a.lastName}`;
              return (
                <tr key={a.id} className={cn("cursor-pointer hover:bg-zinc-50", selected.has(a.id) && "bg-accent-50/40")} onClick={() => open(a)}>
                  {canManage && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} aria-label={`Select ${name}`} />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Avatar name={name} color={candidateColor(a.firstName + a.lastName)} size={24} />
                      <div className="min-w-0">
                        <div className="font-medium text-zinc-900">{name}</div>
                        <div className="truncate text-xs text-zinc-500">{[a.currentTitle, a.currentCompany].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={a.status === "archived" ? "neutral" : a.status === "hired" ? "green" : "accent"}>{stageById[a.stageId]?.name}</Badge>
                    {a.archiveReason && <div className="mt-0.5 text-[11px] text-zinc-500">{a.archiveReason}</div>}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600">{daysSince(a.stageEnteredAt)}d</td>
                  <td className="px-3 py-2"><FeedbackDots feedback={a.feedback} /></td>
                  <td className="px-3 py-2 text-zinc-600">{a.source ?? "—"}</td>
                  <td className="px-3 py-2 text-zinc-600">{a.nextInterview ? fmt(a.nextInterview, "MMM d, h:mm a") : "—"}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{timeAgo(a.appliedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
