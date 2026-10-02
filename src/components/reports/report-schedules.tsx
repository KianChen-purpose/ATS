"use client";

import { useState, useTransition } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { createScheduleAction, updateScheduleAction } from "@/server/actions/reports";

type Person = { id: string; name: string };
export type ScheduleRow = {
  id: string;
  summary: string;
  nextRun: string;
  lastResult: string | null;
  active: boolean;
  recipients: Person[];
};

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Scheduled email delivery for a saved report (owner only). The worker sends them. */
export function ReportSchedules({ reportId, schedules, people, me, timezone }: { reportId: string; schedules: ScheduleRow[]; people: Person[]; me: string; timezone: string }) {
  const [adding, setAdding] = useState(schedules.length === 0);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly">("weekly");
  const [dayOfWeek, setDayOfWeek] = useState(0);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [hour, setHour] = useState(8);
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [recipients, setRecipients] = useState<string[]>([me]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const op = (id: string, o: "pause" | "resume" | "delete" | "send") =>
    start(async () => {
      if (o === "delete" && !confirm("Delete this schedule?")) return;
      const r = await updateScheduleAction(id, reportId, o);
      if ("error" in r) setError(r.error);
    });

  return (
    <div className="space-y-3 px-4 py-3">
      {schedules.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[13px]">
              <div>
                <span className="font-medium">{s.summary}</span>
                {!s.active && <span className="ml-2 rounded bg-zinc-100 px-1.5 text-[11px] text-zinc-600">Paused</span>}
                <span className="block text-xs text-zinc-500">
                  To {s.recipients.map((r) => r.name).join(", ")} · {s.active ? `next ${s.nextRun}` : "not sending"}
                  {s.lastResult && ` · last run: ${s.lastResult}`}
                </span>
              </div>
              <span className="flex gap-1">
                {s.active && (
                  <Button size="sm" disabled={pending} onClick={() => op(s.id, "send")}>
                    Send now
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => op(s.id, s.active ? "pause" : "resume")}>
                  {s.active ? "Pause" : "Resume"}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => op(s.id, "delete")}>
                  Delete
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <form
          className="space-y-3 rounded-md border border-zinc-200 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              const r = await createScheduleAction({ reportId, frequency, dayOfWeek, dayOfMonth, hour, timezone, format, recipientIds: recipients });
              if ("error" in r) setError(r.error);
              else setAdding(false);
            });
          }}
        >
          <div className="flex flex-wrap gap-2">
            <label>
              <span className={labelClass}>Every</span>
              <select aria-label="Frequency" className={inputClass} value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
                <option value="daily">Day</option>
                <option value="weekly">Week</option>
                <option value="monthly">Month</option>
              </select>
            </label>
            {frequency === "weekly" && (
              <label>
                <span className={labelClass}>On</span>
                <select aria-label="Day of the week" className={inputClass} value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))}>
                  {DAYS.map((d, i) => (
                    <option key={d} value={i}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {frequency === "monthly" && (
              <label>
                <span className={labelClass}>On day</span>
                <select aria-label="Day of the month" className={inputClass} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))}>
                  {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span className={labelClass}>At</span>
              <select aria-label="Time" className={inputClass} value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {`${h % 12 || 12}:00 ${h < 12 ? "AM" : "PM"}`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className={labelClass}>As</span>
              <select aria-label="Format" className={inputClass} value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
                <option value="xlsx">Excel</option>
                <option value="csv">CSV</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend className={labelClass}>Send to (people who can open this report)</legend>
            <div className="grid max-h-36 grid-cols-2 gap-x-4 overflow-y-auto sm:grid-cols-3">
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                  <input type="checkbox" checked={recipients.includes(p.id)} onChange={(e) => setRecipients(e.target.checked ? [...recipients, p.id] : recipients.filter((x) => x !== p.id))} />
                  {p.name}
                  {p.id === me && " (you)"}
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-[11px] text-zinc-500">Times are {timezone.replace("_", " ")}. Each person receives the numbers for the jobs they have access to.</p>
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={pending || recipients.length === 0}>
              <CalendarClock size={14} /> Schedule
            </Button>
            {schedules.length > 0 && (
              <Button type="button" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <Button size="sm" onClick={() => setAdding(true)}>
          <CalendarClock size={13} /> Add schedule
        </Button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
