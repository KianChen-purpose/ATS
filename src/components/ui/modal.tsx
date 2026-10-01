"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-zinc-900/30 p-4 pt-[10vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal
        onMouseDown={(e) => e.stopPropagation()}
        className={cn("w-full max-w-lg rounded-xl border border-zinc-200 bg-white shadow-2xl", className)}
      >
        <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-zinc-100 px-4 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export const inputClass =
  "w-full rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-100";
export const labelClass = "mb-1 block text-xs font-medium text-zinc-600";
