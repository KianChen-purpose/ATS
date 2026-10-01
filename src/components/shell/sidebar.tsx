"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, Search } from "lucide-react";
import { cn, ROLE_LABELS } from "@/lib/utils";
import { PatsLogo } from "@/components/logo";
import { Avatar } from "@/components/ui/avatar";
import { NAV, SETTINGS_NAV, type NavItem } from "./nav";
import { signOut } from "@/server/actions/auth";

export function Sidebar({ user }: { user: { name: string; role: string; title: string | null } }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <aside className="flex w-[216px] shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex h-12 items-center px-4">
        <Link href="/">
          <PatsLogo />
        </Link>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={() => window.dispatchEvent(new Event("pats:open-command"))}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-zinc-500 hover:bg-zinc-100"
        >
          <Search size={14} />
          <span className="flex-1 text-left">Search</span>
          <kbd className="rounded border border-zinc-200 bg-white px-1 text-[10px] text-zinc-400">⌘K</kbd>
        </button>
      </div>

      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map((item) => (
          <NavLink key={item.href} item={item} active={isActive(item.href)} />
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-zinc-100 px-2 py-2">
        <NavLink item={SETTINGS_NAV} active={isActive(SETTINGS_NAV.href)} />
        <div className="flex items-center gap-2 rounded-md px-2 py-1.5">
          <Avatar name={user.name} size={26} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-zinc-900">{user.name}</div>
            <div className="truncate text-[11px] text-zinc-500">{ROLE_LABELS[user.role]}</div>
          </div>
          <form action={signOut}>
            <button title="Sign out / switch user" className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700">
              <LogOut size={14} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 font-medium transition-colors",
        active ? "bg-accent-50 text-accent-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
      )}
    >
      <Icon size={16} strokeWidth={active ? 2.2 : 1.8} />
      {item.label}
    </Link>
  );
}
