import { isDemoEnvironment } from "@/server/config";

/** Shown on every page of a demo environment, so it's never mistaken for the real PATS. */
export function DemoBanner() {
  if (!isDemoEnvironment()) return null;
  return (
    <div role="note" className="pointer-events-none fixed bottom-3 left-1/2 z-50 -translate-x-1/2 rounded-full bg-zinc-900 px-3 py-1 text-[11px] font-medium text-white shadow-lg">
      Demo environment · synthetic data only · don&apos;t enter real personal information
    </div>
  );
}
