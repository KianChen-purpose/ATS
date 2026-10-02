"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Link2, Video, Check, Copy } from "lucide-react";
import { TZDate } from "@date-fns/tz";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { cn, DEFAULT_TZ, fmt } from "@/lib/utils";
import { businessDays, busyPeople, slotsForDay, type Busy } from "@/lib/availability";
import { createSchedulingLink, getAvailability, scheduleInterview } from "@/server/actions/scheduling";

type Person = { id: string; name: string; title: string | null; role: string };
type Stage = { id: string; name: string; type: string };

export function Scheduler(props: {
  candidate: { id: string; name: string; email: string | null };
  applicationId: string;
  jobTitle: string;
  stages: Stage[];
  defaultStageId: string | null;
  people: Person[];
  defaultInterviewerIds: string[];
  replaceInterview?: { id: string; title: string; startAt: string };
}) {
  const router = useRouter();
  const [stageId, setStageId] = useState(props.defaultStageId);
  const [duration, setDuration] = useState(props.stages.find((s) => s.id === props.defaultStageId)?.type === "screen" ? 30 : 60);
  const [interviewerIds, setInterviewerIds] = useState<string[]>(props.defaultInterviewerIds);
  const [weekOffset, setWeekOffset] = useState(0);
  const [busy, setBusy] = useState<Record<string, Busy[]>>({});
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [selected, setSelected] = useState<Date | null>(null);
  const [notify, setNotify] = useState(true);
  const [mode, setMode] = useState<"pick" | "link">("pick");
  const [linkDays, setLinkDays] = useState(7);
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Captured once so render stays pure; the page is short-lived.
  const [now] = useState(() => Date.now());

  // Monday of the visible week, in Toronto time.
  const weekStart = useMemo(() => {
    const today = new TZDate(now, DEFAULT_TZ);
    const dow = (today.getDay() + 6) % 7;
    return new TZDate(today.getFullYear(), today.getMonth(), today.getDate() - dow + weekOffset * 7, 0, 0, 0, DEFAULT_TZ);
  }, [weekOffset, now]);
  const days = useMemo(() => businessDays(weekStart, 7), [weekStart]);

  useEffect(() => {
    if (interviewerIds.length === 0) return;
    startLoading(async () => setBusy(await getAvailability(interviewerIds, new Date(weekStart.getTime()).toISOString(), 7)));
  }, [interviewerIds, weekStart]);

  const visibleBusy = useMemo(() => Object.fromEntries(interviewerIds.map((id) => [id, busy[id] ?? []])), [busy, interviewerIds]);
  const nameById = Object.fromEntries(props.people.map((p) => [p.id, p.name]));
  const toggle = (id: string) => {
    setSelected(null);
    setInterviewerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const people = props.people.filter((p) => !search || p.name.toLowerCase().includes(search.toLowerCase()));

  const confirm = () =>
    startSaving(async () => {
      try {
        await scheduleInterview({
          applicationId: props.applicationId,
          stageId,
          interviewerIds,
          startISO: selected!.toISOString(),
          durationMin: duration,
          notifyCandidate: notify,
          replaceInterviewId: props.replaceInterview?.id,
        });
        router.push(`/candidates/${props.candidate.id}?app=${props.applicationId}`);
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
      }
    });

  const sendLink = () =>
    startSaving(async () => {
      try {
        const { url } = await createSchedulingLink({ applicationId: props.applicationId, stageId, interviewerIds, durationMin: duration, days: linkDays, sendEmail: notify });
        setLinkUrl(url);
      } catch (e) {
        alert((e as Error).message);
      }
    });

  return (
    <div className="flex min-h-0 flex-1">
      {/* Settings */}
      <div className="w-80 shrink-0 space-y-4 overflow-y-auto border-r border-zinc-200 bg-white p-4">
        {props.replaceInterview && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Rescheduling <strong>{props.replaceInterview.title}</strong> from {fmt(props.replaceInterview.startAt, "EEE MMM d, h:mm a")}. The original Outlook event will be cancelled.
          </div>
        )}
        <div className="flex rounded-md border border-zinc-200 p-0.5">
          {(["pick", "link"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={cn("flex-1 rounded px-2 py-1 font-medium", mode === m ? "bg-accent-50 text-accent-700" : "text-zinc-500")}>
              {m === "pick" ? "Pick a time" : "Self-schedule link"}
            </button>
          ))}
        </div>
        <div>
          <label className={labelClass}>Stage</label>
          <select className={inputClass} value={stageId ?? ""} onChange={(e) => setStageId(e.target.value || null)}>
            {props.stages.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Duration</label>
          <select className={inputClass} value={duration} onChange={(e) => { setDuration(Number(e.target.value)); setSelected(null); }}>
            {[30, 45, 60, 90, 120].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Interviewers ({interviewerIds.length})</label>
          <input className={`${inputClass} mb-1.5`} placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="max-h-64 space-y-0.5 overflow-y-auto">
            {people.map((p) => (
              <label key={p.id} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-zinc-50", interviewerIds.includes(p.id) && "bg-accent-50/60")}>
                <input type="checkbox" checked={interviewerIds.includes(p.id)} onChange={() => toggle(p.id)} />
                <Avatar name={p.name} size={20} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{p.name}</span>
                  <span className="block truncate text-[11px] text-zinc-500">{p.title}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        {mode === "link" && (
          <div>
            <label className={labelClass}>Candidate can pick from the next</label>
            <select className={inputClass} value={linkDays} onChange={(e) => setLinkDays(Number(e.target.value))}>
              {[3, 5, 7, 10, 14].map((d) => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </div>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          {mode === "pick" ? "Email confirmation to candidate" : "Email link to candidate"}
        </label>

        {mode === "pick" ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            {selected ? (
              <>
                <div className="font-medium">{fmt(selected, "EEEE, MMM d")}</div>
                <div className="text-zinc-600">
                  {fmt(selected, "h:mm a")} – {fmt(new Date(selected.getTime() + duration * 60_000), "h:mm a")} ET
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-teams"><Video size={12} /> Teams meeting will be created</div>
                <Button variant="primary" className="mt-3 w-full" disabled={saving || interviewerIds.length === 0} onClick={confirm}>
                  {saving ? "Scheduling…" : props.replaceInterview ? "Reschedule interview" : "Schedule interview"}
                </Button>
              </>
            ) : (
              <div className="text-xs text-zinc-500">Pick a time on the calendar. Green slots work for everyone.</div>
            )}
          </div>
        ) : linkUrl ? (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="flex items-center gap-1 font-medium text-emerald-800"><Check size={14} /> Link created{notify && " and emailed"}</div>
            <div className="mt-2 flex items-center gap-1">
              <input readOnly value={linkUrl} className={`${inputClass} text-xs`} />
              <button onClick={() => navigator.clipboard.writeText(linkUrl)} className="rounded border border-zinc-200 bg-white p-1.5" title="Copy"><Copy size={13} /></button>
            </div>
            <a href={linkUrl} target="_blank" className="mt-2 inline-block text-xs text-accent-700 hover:underline">Preview as candidate</a>
          </div>
        ) : (
          <Button variant="primary" className="w-full" disabled={saving || interviewerIds.length === 0} onClick={sendLink}>
            <Link2 size={14} /> {saving ? "Creating…" : "Create self-scheduling link"}
          </Button>
        )}
      </div>

      {/* Calendar */}
      <div className="min-w-0 flex-1 overflow-auto bg-white">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-200 bg-white px-4 py-2">
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setWeekOffset((w) => Math.max(0, w - 1))} disabled={weekOffset === 0}><ChevronLeft size={14} /></Button>
            <Button size="sm" onClick={() => setWeekOffset((w) => w + 1)}><ChevronRight size={14} /></Button>
            <span className="font-medium">Week of {fmt(weekStart, "MMMM d, yyyy")}</span>
            {loading && <span className="text-xs text-zinc-400">Checking Outlook calendars…</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-100 ring-1 ring-emerald-300" /> Everyone free</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-100 ring-1 ring-amber-300" /> Some busy</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-zinc-200" /> All busy</span>
            <span>Times in Eastern</span>
          </div>
        </div>
        <div className="grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(120px, 1fr))` }}>
          <div />
          {days.map((d) => (
            <div key={d.getTime()} className="border-b border-l border-zinc-100 px-2 py-1.5 text-center">
              <div className="text-[11px] font-medium text-zinc-500 uppercase">{fmt(d, "EEE")}</div>
              <div className="font-semibold">{fmt(d, "MMM d")}</div>
            </div>
          ))}
          {slotsForDay(days[0], 30).map((row, ri) => (
            <Row key={ri} rowIndex={ri} label={fmt(row.start, "h:mm a")} days={days} duration={duration} busy={visibleBusy} nameById={nameById} selected={selected} onSelect={setSelected} enabled={mode === "pick"} now={now} />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  rowIndex,
  label,
  days,
  duration,
  busy,
  nameById,
  selected,
  onSelect,
  enabled,
  now,
}: {
  now: number;
  rowIndex: number;
  label: string;
  days: TZDate[];
  duration: number;
  busy: Record<string, Busy[]>;
  nameById: Record<string, string>;
  selected: Date | null;
  onSelect: (d: Date) => void;
  enabled: boolean;
}) {
  const people = Object.keys(busy).length;
  return (
    <>
      <div className="border-b border-zinc-50 pr-2 text-right text-[10px] leading-8 text-zinc-400">{rowIndex % 2 === 0 ? label : ""}</div>
      {days.map((d) => {
        const slot = slotsForDay(d, 30)[rowIndex];
        const full = { start: slot.start, end: new Date(slot.start.getTime() + duration * 60_000) };
        const endOfDay = slotsForDay(d, 30).at(-1)!.end;
        const fits = full.end <= endOfDay;
        const past = slot.start.getTime() < now;
        const who = busyPeople(full, busy);
        const isSel = selected?.getTime() === slot.start.getTime();
        const tone = !fits || past ? "bg-zinc-50" : people === 0 ? "bg-white" : who.length === 0 ? "bg-emerald-50 hover:bg-emerald-100" : who.length < people ? "bg-amber-50 hover:bg-amber-100" : "bg-zinc-100 hover:bg-zinc-200";
        return (
          <button
            key={d.getTime()}
            disabled={!enabled || !fits || past || people === 0}
            onClick={() => onSelect(slot.start)}
            title={who.length ? `Busy: ${who.map((id) => nameById[id]).join(", ")}` : "Everyone is free"}
            className={cn("h-8 border-b border-l border-zinc-100 text-[10px] text-zinc-500 transition-colors disabled:cursor-default", tone, isSel && "bg-accent-600! text-white ring-2 ring-accent-300")}
          >
            {isSel ? `${fmt(slot.start, "h:mm")} ✓` : who.length > 0 && who.length < people ? `${people - who.length}/${people}` : ""}
          </button>
        );
      })}
    </>
  );
}
