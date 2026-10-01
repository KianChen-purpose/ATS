import { Construction } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";

export function ComingSoon({ title, phase, features }: { title: string; phase: string; features: string[] }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="mx-auto max-w-xl px-6 py-14 text-center">
        <Construction className="mx-auto text-zinc-300" size={36} />
        <h2 className="mt-3 text-base font-semibold">Coming in {phase}</h2>
        <ul className="mt-3 inline-block space-y-1 text-left text-zinc-600">
          {features.map((f) => (
            <li key={f}>• {f}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
