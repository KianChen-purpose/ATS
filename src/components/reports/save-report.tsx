"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { saveDashboardAction, saveReportAction } from "@/server/actions/reports";

type Person = { id: string; name: string; role: string };
type Visibility = "private" | "people" | "everyone";
export type SharingValue = { visibility: Visibility; shareWith: string[] };

/** Private / named people / everyone with report access. Viewers always see their own numbers. */
export function SharingFields({ value, onChange, people }: { value: SharingValue; onChange: (v: SharingValue) => void; people: Person[] }) {
  const [q, setQ] = useState("");
  const shown = people.filter((p) => p.name.toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <fieldset className="space-y-2">
      <legend className={labelClass}>Who can open it</legend>
      {(
        [
          ["private", "Only me"],
          ["people", "Specific people"],
          ["everyone", "Everyone who can open reports"],
        ] as const
      ).map(([k, label]) => (
        <label key={k} className="flex items-center gap-2 text-[13px]">
          <input type="radio" name="visibility" checked={value.visibility === k} onChange={() => onChange({ ...value, visibility: k })} />
          {label}
        </label>
      ))}
      {value.visibility === "people" && (
        <div className="rounded-md border border-zinc-200 p-2">
          <input className={inputClass} placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
          <div className="mt-1.5 max-h-40 overflow-y-auto">
            {shown.map((p) => (
              <label key={p.id} className="flex items-center gap-2 py-0.5 text-[13px]">
                <input
                  type="checkbox"
                  checked={value.shareWith.includes(p.id)}
                  onChange={(e) => onChange({ ...value, shareWith: e.target.checked ? [...value.shareWith, p.id] : value.shareWith.filter((x) => x !== p.id) })}
                />
                {p.name}
              </label>
            ))}
          </div>
        </div>
      )}
      <p className="text-[11px] text-zinc-500">Sharing shares the report, not your numbers: each person sees only the jobs they have access to.</p>
    </fieldset>
  );
}

export function SaveReportButton({
  definition,
  filters,
  people,
  editing,
}: {
  definition: unknown;
  filters: Record<string, string>;
  people: Person[];
  editing?: { id: string; name: string; description: string | null; visibility: Visibility; shareWith: string[] } | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [sharing, setSharing] = useState<SharingValue>({ visibility: editing?.visibility ?? "private", shareWith: editing?.shareWith ?? [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(asNew: boolean) {
    setError(null);
    start(async () => {
      const r = await saveReportAction({ id: asNew ? undefined : editing?.id, name, description, definition, filters, ...sharing });
      if ("error" in r) return setError(r.error);
      setOpen(false);
      router.push(`/reports/saved/${r.id}`);
    });
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Save size={14} /> {editing ? "Save changes" : "Save report"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `Save “${editing.name}”` : "Save report"}
        footer={
          <>
            {editing && (
              <Button onClick={() => save(true)} disabled={pending || name.trim().length < 2}>
                Save as new
              </Button>
            )}
            <Button variant="primary" onClick={() => save(false)} disabled={pending || name.trim().length < 2}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          </label>
          <label className="block">
            <span className={labelClass}>Description (optional)</span>
            <textarea className={inputClass} rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} />
          </label>
          <SharingFields value={sharing} onChange={setSharing} people={people} />
          <p className="text-[11px] text-zinc-500">The current date range and brand, department and job filters are saved as the report&apos;s defaults.</p>
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      </Modal>
    </>
  );
}

export function NewDashboardButton({ people }: { people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [sharing, setSharing] = useState<SharingValue>({ visibility: "private", shareWith: [] });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <Button onClick={() => setOpen(true)}>New dashboard</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New dashboard"
        footer={
          <Button
            variant="primary"
            disabled={pending || name.trim().length < 2}
            onClick={() =>
              start(async () => {
                const r = await saveDashboardAction({ name, ...sharing, reportIds: [] });
                if ("error" in r) return setError(r.error);
                setOpen(false);
                router.push(`/reports/dashboards/${r.id}`);
              })
            }
          >
            Create
          </Button>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className={labelClass}>Name</span>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus />
          </label>
          <SharingFields value={sharing} onChange={setSharing} people={people} />
          {error && <p className="text-xs text-red-700">{error}</p>}
        </div>
      </Modal>
    </>
  );
}
