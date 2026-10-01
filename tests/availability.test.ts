import { describe, expect, it } from "vitest";
import { businessDays, busyPeople, commonFreeSlots, slotsForDay } from "@/lib/availability";

const TZ = "America/Toronto";

describe("availability", () => {
  it("skips weekends", () => {
    // Fri 2 Oct 2026 → Fri, Mon, Tue over four calendar days
    const days = businessDays(new Date("2026-10-02T12:00:00Z"), 4, TZ);
    expect(days.map((d) => d.getDay())).toEqual([5, 1]);
  });

  it("builds 9–5 Toronto slots in 30-minute steps", () => {
    const [day] = businessDays(new Date("2026-10-05T12:00:00Z"), 1, TZ);
    const slots = slotsForDay(day, 60, TZ);
    expect(slots[0].start.toISOString()).toBe("2026-10-05T13:00:00.000Z"); // 9:00 EDT
    expect(slots.at(-1)!.end.toISOString()).toBe("2026-10-05T21:00:00.000Z"); // 17:00 EDT
    expect(slots).toHaveLength(15);
  });

  it("treats overlapping blocks as busy and back-to-back blocks as free", () => {
    const slot = { start: new Date("2026-10-05T14:00:00Z"), end: new Date("2026-10-05T15:00:00Z") };
    const busy = {
      a: [{ start: "2026-10-05T14:30:00Z", end: "2026-10-05T15:30:00Z" }],
      b: [{ start: "2026-10-05T15:00:00Z", end: "2026-10-05T16:00:00Z" }],
    };
    expect(busyPeople(slot, busy)).toEqual(["a"]);
  });

  it("only offers slots where everyone is free", () => {
    const from = new Date(Date.now() + 7 * 86_400_000);
    const all = commonFreeSlots({ busy: {}, from, days: 7, durationMin: 30, tz: TZ });
    const blocked = { x: [{ start: all[0].start, end: all[0].end }] };
    const free = commonFreeSlots({ busy: blocked, from, days: 7, durationMin: 30, tz: TZ });
    expect(free).toHaveLength(all.length - 1);
    expect(free.some((s) => s.start.getTime() === all[0].start.getTime())).toBe(false);
  });
});
