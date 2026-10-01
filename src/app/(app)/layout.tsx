import { requireUser } from "@/lib/session";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return (
    <div className="flex h-full">
      <Sidebar user={{ name: user.name, role: user.role, avatarColor: user.avatarColor, title: user.title }} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}
