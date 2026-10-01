import { cn, initials } from "@/lib/utils";

export function Avatar({
  name,
  color = "#71717a",
  size = 24,
  className,
}: {
  name: string;
  color?: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white select-none", className)}
      style={{ width: size, height: size, background: color, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}

/** Candidates don't have a chosen color, so derive a stable one from their name. */
export function candidateColor(name: string) {
  const palette = ["#64748b", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#2563eb"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
