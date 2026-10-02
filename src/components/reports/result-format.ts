import { fmt, money } from "@/lib/utils";
import type { Format } from "@/server/services/reports/datasets";
import { daysLabel, hoursLabel, nf, pct } from "./format";

export function formatValue(v: number | null, format: Format = "count") {
  if (v == null) return "—";
  switch (format) {
    case "count":
      return nf.format(v);
    case "percent":
      return pct(v);
    case "days":
      return daysLabel(v);
    case "hours":
      return hoursLabel(v);
    case "money":
      return money(Math.round(v));
  }
}

/** Display label for a dimension value; empty values get a visible placeholder. */
export const keyLabel = (k: string | null) => (k == null || k === "" ? "(none)" : k);

/** Readable time-bucket label (week, month); other values pass through. */
export function timeLabel(k: string | null, key: string) {
  if (!k) return "(none)";
  if (key === "week" && /^\d{4}-\d{2}-\d{2}$/.test(k)) return fmt(`${k}T12:00:00Z`, "MMM d", "UTC");
  if (key === "month" && /^\d{4}-\d{2}$/.test(k)) return fmt(`${k}-01T12:00:00Z`, "MMM yyyy", "UTC");
  return k;
}
