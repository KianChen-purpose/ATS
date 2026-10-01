import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-zinc-100 text-zinc-700",
  accent: "bg-accent-50 text-accent-700",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
} as const;

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: keyof typeof tones;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap", tones[tone], className)}>
      {children}
    </span>
  );
}
