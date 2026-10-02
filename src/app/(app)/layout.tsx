import { requireUser } from "@/lib/session";
import { userActor } from "@/server/policy";
import { waitingCount } from "@/server/services/approval-inbox";
import { Sidebar } from "@/components/shell/sidebar";
import { CommandPalette } from "@/components/shell/command-palette";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const approvalsWaiting = await waitingCount(userActor(user));
  return (
    <div className="flex h-full">
      <Sidebar user={{ name: user.name, role: user.role, title: user.title }} approvalsWaiting={approvalsWaiting} />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <CommandPalette />
    </div>
  );
}
