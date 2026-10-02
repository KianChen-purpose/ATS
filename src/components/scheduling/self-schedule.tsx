"use client";

import { useMemo, useState, useTransition } from "react";
import { CalendarCheck, Video } from "lucide-react";
import { bookSchedulingLink } from "@/server/actions/scheduling";

/** Candidate-facing slot picker. Shows times in the candidate's own browser time zone. */
export function SelfSchedule({ token, slots, durationMin, brandColor }: { token: string; slots: string[]; durationMin: number; brandColor: string }) {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [selected, setSelected] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ startISO: string; meetingUrl: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const byDay = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const s of slots) {
      const key = new Date(s).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: tz });
      m.set(key, [...(m.get(key) ?? []), s]);
    }
    return [...m.entries()];
  }, [slots, tz]);
  const [day, setDay] = useState(0);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz });

  if (booked) {
    return (
      <div className="py-6 text-center">
        <CalendarCheck className="mx-auto" size={36} style={{ color: brandColor }} />
        <h2 className="mt-3 text-lg font-semibold">You&apos;re booked!</h2>
        <p className="mt-1 text-zinc-600">
          {new Date(booked.startISO).toLocaleString(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz })}
        </p>
        <p className="mt-1 text-xs text-zinc-500">A calendar invitation and confirmation email are on their way.</p>
        {booked.meetingUrl && (
          <a href={booked.meetingUrl} className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-teams px-3 py-1.5 font-medium text-white">
            <Video size={14} /> Microsoft Teams link
          </a>
        )}
      </div>
    );
  }

  if (slots.length === 0) {
    return <p className="py-6 text-center text-zinc-600">There are no open times right now. Please reply to the email you received and we&apos;ll find a time.</p>;
  }

  return (
    <div>
      <p className="mb-3 text-xs text-zinc-500">Times shown in your time zone ({tz}). {durationMin} minutes.</p>
      <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
        <ul className="space-y-1">
          {byDay.map(([label, list], i) => (
            <li key={label}>
              <button
                onClick={() => { setDay(i); setSelected(null); }}
                className="w-full rounded-md border px-3 py-2 text-left"
                style={i === day ? { borderColor: brandColor, background: `color-mix(in srgb, ${brandColor} 8%, transparent)` } : { borderColor: "var(--color-zinc-200)" }}
              >
                <div className="font-medium">{label}</div>
                <div className="text-xs text-zinc-500">{list.length} times</div>
              </button>
            </li>
          ))}
        </ul>
        <div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {byDay[day]?.[1].map((s) => (
              <button
                key={s}
                onClick={() => setSelected(s)}
                className="rounded-md border px-2 py-2 font-medium"
                style={selected === s ? { background: brandColor, borderColor: brandColor, color: "var(--pats-ivory)" } : { borderColor: "var(--color-zinc-200)" }}
              >
                {time(s)}
              </button>
            ))}
          </div>
          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
          <button
            disabled={!selected || pending}
            onClick={() =>
              start(async () => {
                setError(null);
                try {
                  setBooked(await bookSchedulingLink(token, selected!));
                } catch (e) {
                  setError((e as Error).message);
                }
              })
            }
            className="mt-4 h-10 w-full rounded-md font-medium text-white disabled:opacity-40"
            style={{ background: brandColor }}
          >
            {pending ? "Booking…" : selected ? `Confirm ${time(selected)}` : "Select a time"}
          </button>
        </div>
      </div>
    </div>
  );
}
