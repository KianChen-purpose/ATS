import { TZDate } from "@date-fns/tz";
import { DEFAULT_TZ } from "./utils";

export type Busy = { start: Date | string; end: Date | string; status?: string };

export const BUSINESS_HOURS = { startHour: 9, endHour: 17 } as const;
export const SLOT_STEP_MIN = 30;

/** Midnight (in tz) of each weekday between `from` and `from + days`. */
export function businessDays(from: Date, days: number, tz = DEFAULT_TZ): TZDate[] {
  const out: TZDate[] = [];
  const start = new TZDate(from.getTime(), tz);
  for (let i = 0; i < days; i++) {
    const d = new TZDate(start.getFullYear(), start.getMonth(), start.getDate() + i, 0, 0, 0, tz);
    const dow = d.getDay();
    if (dow !== 0 && dow !== 6) out.push(d);
  }
  return out;
}

export function slotsForDay(day: TZDate, durationMin: number, tz = DEFAULT_TZ): { start: Date; end: Date }[] {
  const slots: { start: Date; end: Date }[] = [];
  for (let m = BUSINESS_HOURS.startHour * 60; m + durationMin <= BUSINESS_HOURS.endHour * 60; m += SLOT_STEP_MIN) {
    const start = new TZDate(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(m / 60), m % 60, 0, tz);
    slots.push({ start: new Date(start.getTime()), end: new Date(start.getTime() + durationMin * 60_000) });
  }
  return slots;
}

export function overlaps(a: { start: Date; end: Date }, b: Busy) {
  return a.start.getTime() < new Date(b.end).getTime() && a.end.getTime() > new Date(b.start).getTime();
}

/** People (by key) who are busy during the slot. Tentative holds count as busy. */
export function busyPeople(slot: { start: Date; end: Date }, busy: Record<string, Busy[]>) {
  return Object.entries(busy)
    .filter(([, blocks]) => blocks.some((b) => overlaps(slot, b)))
    .map(([k]) => k);
}

/** Slots in the window where every person is free, at least `minNoticeHours` from now. */
export function commonFreeSlots(opts: {
  busy: Record<string, Busy[]>;
  from: Date;
  days: number;
  durationMin: number;
  minNoticeHours?: number;
  tz?: string;
}) {
  const earliest = Date.now() + (opts.minNoticeHours ?? 12) * 3_600_000;
  return businessDays(opts.from, opts.days, opts.tz)
    .flatMap((d) => slotsForDay(d, opts.durationMin, opts.tz))
    .filter((s) => s.start.getTime() >= earliest && busyPeople(s, opts.busy).length === 0);
}
