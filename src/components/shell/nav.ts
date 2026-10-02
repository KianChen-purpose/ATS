import {
  Home,
  Briefcase,
  Users,
  CalendarDays,
  Telescope,
  FileSignature,
  BadgeCheck,
  BarChart3,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type NavItem = { href: string; label: string; icon: LucideIcon; shortcut?: string };

export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, shortcut: "G H" },
  { href: "/jobs", label: "Jobs", icon: Briefcase, shortcut: "G J" },
  { href: "/candidates", label: "Candidates", icon: Users, shortcut: "G C" },
  { href: "/interviews", label: "Interviews", icon: CalendarDays, shortcut: "G I" },
  { href: "/sourcing", label: "Sourcing", icon: Telescope, shortcut: "G S" },
  { href: "/offers", label: "Offers", icon: FileSignature, shortcut: "G O" },
  { href: "/approvals", label: "Approvals", icon: BadgeCheck, shortcut: "G A" },
  { href: "/reports", label: "Reports", icon: BarChart3, shortcut: "G R" },
];

export const SETTINGS_NAV: NavItem = { href: "/settings", label: "Settings", icon: Settings };
