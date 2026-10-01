export function PatsLogo({ size = 22 }: { size?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
        <rect width="24" height="24" rx="6" fill="var(--color-accent-600)" />
        <path d="M8 17V7h4.6a3.4 3.4 0 0 1 0 6.8H8" stroke="white" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-zinc-900">PATS</span>
    </span>
  );
}
