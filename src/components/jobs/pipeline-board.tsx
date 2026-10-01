"use client";

import { useOptimistic, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { moveToStage } from "@/server/actions/applications";
import type { PipelineApp } from "@/server/services/jobs";
import { PipelineCard } from "./pipeline-card";

type Stage = { id: string; name: string; type: string };

type Move = { appId: string; stageId: string; hired: boolean };

export function PipelineBoard({ stages, apps: initial, canManage }: { stages: Stage[]; apps: PipelineApp[]; canManage: boolean }) {
  // Optimistic: move the card immediately; server data replaces it once the action + refresh finish.
  const [apps, applyMove] = useOptimistic(initial, (prev: PipelineApp[], m: Move) =>
    m.hired ? prev.filter((a) => a.id !== m.appId) : prev.map((a) => (a.id === m.appId ? { ...a, stageId: m.stageId, stageEnteredAt: new Date() } : a)),
  );
  const [, start] = useTransition();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedApp = params.get("app");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const open = (a: PipelineApp) => {
    const p = new URLSearchParams(params);
    p.set("c", a.candidateId);
    p.set("app", a.id);
    router.push(`${pathname}?${p}`, { scroll: false });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const appId = String(e.active.id);
    const stageId = e.over ? String(e.over.id) : null;
    const app = apps.find((a) => a.id === appId);
    if (!stageId || !app || app.stageId === stageId) return;
    const target = stages.find((s) => s.id === stageId);
    start(async () => {
      applyMove({ appId, stageId, hired: target?.type === "hired" });
      try {
        await moveToStage([appId], stageId);
      } catch (err) {
        alert((err as Error).message);
      }
      router.refresh();
    });
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex h-full gap-3 overflow-x-auto px-6 py-4">
        {stages.map((stage) => {
          const cards = apps.filter((a) => a.stageId === stage.id);
          return (
            <Column key={stage.id} stage={stage} count={cards.length}>
              {cards.map((a) =>
                canManage ? (
                  <DraggableCard key={a.id} id={a.id} onClick={() => open(a)}>
                    <PipelineCard app={a} selected={a.id === selectedApp} />
                  </DraggableCard>
                ) : (
                  <button key={a.id} className="block w-full text-left" onClick={() => open(a)}>
                    <PipelineCard app={a} selected={a.id === selectedApp} />
                  </button>
                ),
              )}
            </Column>
          );
        })}
      </div>
    </DndContext>
  );
}

function Column({ stage, count, children }: { stage: Stage; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div className="flex w-64 shrink-0 flex-col">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="truncate text-xs font-semibold text-zinc-700">{stage.name}</span>
        <span className="rounded bg-zinc-200/70 px-1.5 text-[11px] font-medium text-zinc-600">{count}</span>
      </div>
      <div
        ref={setNodeRef}
        className={cn("flex min-h-24 flex-1 flex-col gap-2 rounded-lg p-1.5 transition-colors", isOver ? "bg-accent-50 ring-2 ring-accent-200" : "bg-zinc-100/70")}
      >
        {children}
      </div>
    </div>
  );
}

function DraggableCard({ id, onClick, children }: { id: string; onClick: () => void; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={onClick}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("cursor-grab touch-none active:cursor-grabbing", isDragging && "relative z-30 rotate-1 opacity-90 shadow-lg")}
    >
      {children}
    </div>
  );
}
