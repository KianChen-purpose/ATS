"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { Briefcase, User } from "lucide-react";
import { NAV, SETTINGS_NAV } from "./nav";
import { searchEverything, type SearchResult } from "@/server/actions/search";

/** Cmd/Ctrl+K palette plus "G then X" navigation shortcuts. */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult>({ candidates: [], jobs: [] });
  const [, startTransition] = useTransition();
  const lastG = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key.toLowerCase() === "g") {
        lastG.current = Date.now();
        return;
      }
      if (Date.now() - lastG.current < 800) {
        const item = [...NAV, SETTINGS_NAV].find((n) => n.shortcut?.endsWith(e.key.toUpperCase()));
        if (item) {
          lastG.current = 0;
          router.push(item.href);
        }
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pats:open-command", onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pats:open-command", onOpen);
    };
  }, [router]);

  useEffect(() => {
    const t = setTimeout(() => startTransition(async () => setResults(await searchEverything(query))), 120);
    return () => clearTimeout(t);
  }, [query]);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  if (!open) return null;
  const navMatches = [...NAV, SETTINGS_NAV].filter((n) => !query || n.label.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-zinc-900/20 pt-[12vh]" onClick={() => setOpen(false)}>
      <Command
        shouldFilter={false}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl"
        onKeyDown={(e) => e.key === "Escape" && setOpen(false)}
      >
        <Command.Input
          autoFocus
          value={query}
          onValueChange={setQuery}
          placeholder="Search candidates, jobs, or jump to…"
          className="h-12 w-full border-b border-zinc-100 px-4 text-sm outline-none placeholder:text-zinc-400"
        />
        <Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-zinc-500">No results</Command.Empty>
          {results.candidates.length > 0 && (
            <Command.Group heading="Candidates" className="cmdk-group">
              {results.candidates.map((c) => (
                <Item key={c.id} value={`c-${c.id}`} onSelect={() => go(`/candidates/${c.id}`)}>
                  <User size={14} className="text-zinc-400" />
                  <span className="font-medium">{c.name}</span>
                  <span className="truncate text-zinc-500">{c.subtitle}</span>
                </Item>
              ))}
            </Command.Group>
          )}
          {results.jobs.length > 0 && (
            <Command.Group heading="Jobs" className="cmdk-group">
              {results.jobs.map((j) => (
                <Item key={j.id} value={`j-${j.id}`} onSelect={() => go(`/jobs/${j.id}`)}>
                  <Briefcase size={14} className="text-zinc-400" />
                  <span className="font-medium">{j.title}</span>
                  <span className="truncate text-zinc-500">{j.subtitle}</span>
                </Item>
              ))}
            </Command.Group>
          )}
          {navMatches.length > 0 && (
          <Command.Group heading="Go to" className="cmdk-group">
            {navMatches.map((n) => (
                <Item key={n.href} value={`nav-${n.href}`} onSelect={() => go(n.href)}>
                  <n.icon size={14} className="text-zinc-400" />
                  <span>{n.label}</span>
                  {n.shortcut && <kbd className="ml-auto text-[10px] text-zinc-400">{n.shortcut}</kbd>}
                </Item>
              ))}
          </Command.Group>
          )}
        </Command.List>
      </Command>
    </div>
  );
}

function Item({ children, ...props }: React.ComponentProps<typeof Command.Item>) {
  return (
    <Command.Item
      {...props}
      className="flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] data-[selected=true]:bg-accent-50 data-[selected=true]:text-accent-700"
    >
      {children}
    </Command.Item>
  );
}
