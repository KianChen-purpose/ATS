export function PageHeader({
  title,
  subtitle,
  actions,
  children,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-zinc-200 bg-white px-6 pt-4">
      <div className="flex items-start justify-between gap-4 pb-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-zinc-900">{title}</h1>
          {subtitle && <div className="mt-0.5 text-xs text-zinc-500">{subtitle}</div>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
