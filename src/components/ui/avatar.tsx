import { cn, initials } from "@/lib/utils";

/**
 * Avatar tones come from the brand tokens (see globals.css): darker tones carry Ivory initials,
 * lighter ones Black, all at WCAG AA contrast or better. A person's tone is derived from their
 * name, so it's stable without storing a colour.
 */
const TONES = [
  "bg-avatar-1 text-[var(--pats-ivory)]",
  "bg-avatar-2 text-[var(--pats-ivory)]",
  "bg-avatar-3 text-[var(--pats-ivory)]",
  "bg-avatar-4 text-[var(--pats-black)]",
  "bg-avatar-5 text-[var(--pats-black)]",
] as const;

function toneFor(name: string) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}

export function Avatar({ name, size = 24, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      title={name}
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-medium select-none", toneFor(name), className)}
      style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }}
    >
      {initials(name)}
    </span>
  );
}
