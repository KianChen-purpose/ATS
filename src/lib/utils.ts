import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistanceToNowStrict } from "date-fns";
import { TZDate } from "@date-fns/tz";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fullName(p: { firstName: string; lastName: string }) {
  return `${p.firstName} ${p.lastName}`;
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]!.toUpperCase())
    .join("");
}

export function timeAgo(d: Date | string | null | undefined) {
  if (!d) return "—";
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true });
}

/** Whole days between `d` and now. */
export function daysSince(d: Date | string) {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000));
}

export function money(n: number | null | undefined, currency = "CAD") {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
}

export function compRange(min: number | null, max: number | null, currency = "CAD") {
  if (min == null && max == null) return "—";
  const k = (n: number) => `$${Math.round(n / 1000)}k`;
  if (min != null && max != null) return `${k(min)}–${k(max)} ${currency}`;
  return `${k((min ?? max)!)} ${currency}`;
}

export const ROLE_LABELS: Record<string, string> = {
  admin: "Admin",
  recruiter: "Recruiter",
  coordinator: "Coordinator",
  hiring_manager: "Hiring Manager",
  interviewer: "Interviewer",
  executive: "Executive",
};

export const RECOMMENDATION_LABELS: Record<string, { label: string; className: string }> = {
  strong_yes: { label: "Strong Yes", className: "bg-emerald-100 text-emerald-800" },
  yes: { label: "Yes", className: "bg-green-50 text-green-700" },
  no: { label: "No", className: "bg-orange-50 text-orange-700" },
  strong_no: { label: "Strong No", className: "bg-red-100 text-red-800" },
};

/** All staff-facing times render in Purpose's home timezone until per-user timezones are wired up. */
export const DEFAULT_TZ = "America/Toronto";

export function fmt(d: Date | string, pattern: string, tz: string = DEFAULT_TZ) {
  return format(new TZDate(new Date(d).getTime(), tz), pattern);
}
