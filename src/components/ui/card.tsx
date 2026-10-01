import { cn } from "@/lib/utils";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-lg border border-zinc-200 bg-white", className)}>{children}</div>;
}

export function CardHeader({ title, action, className }: { title: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between border-b border-zinc-100 px-4 py-2.5", className)}>
      <h3 className="text-[13px] font-semibold text-zinc-900">{title}</h3>
      {action}
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-zinc-300">{icon}</div>}
      <div className="text-[13px] font-medium text-zinc-700">{title}</div>
      {description && <div className="max-w-sm text-xs text-zinc-500">{description}</div>}
    </div>
  );
}
