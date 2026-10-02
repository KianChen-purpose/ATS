"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { addApplicationQuestion, moveApplicationQuestion, setApplicationQuestionActive } from "@/server/actions/application-forms";

type Kind = "short_text" | "long_text" | "yes_no" | "single_select";
type Option = { value: string; en: string; fr: string };
type Question = { id: string; kind: Kind; labelEn: string; labelFr: string; options: Option[]; required: boolean; passAnswers: string[] | null; active: boolean };

const KIND_LABEL: Record<Kind, string> = { short_text: "Short answer", long_text: "Paragraph", yes_no: "Yes / No", single_select: "Choice" };
const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "option";

export function QuestionBuilder({ jobId, questions, canManage }: { jobId: string; questions: Question[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<unknown>) => start(async () => { await fn(); router.refresh(); });

  return (
    <div className="space-y-3">
      <p className="text-zinc-600">
        Shown on the career site after the standard fields (name, email, resume, consent). Knockout questions archive an application automatically when the answer doesn&apos;t pass.
      </p>
      {questions.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-center text-zinc-500">No questions yet.</p>
      ) : (
        <ol className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {questions.map((q, i) => (
            <li key={q.id} className="flex items-start gap-3 px-4 py-3">
              <span className="w-5 pt-0.5 text-right text-xs text-zinc-500">{i + 1}.</span>
              <div className="min-w-0 flex-1">
                <div className="font-medium">{q.labelEn}</div>
                <div className="text-xs text-zinc-500" lang="fr-CA">{q.labelFr}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <Badge tone="neutral">{KIND_LABEL[q.kind]}</Badge>
                  {q.required && <Badge tone="neutral">Required</Badge>}
                  {q.passAnswers && <Badge tone="amber">Knockout · passes on {q.passAnswers.map((a) => q.options.find((o) => o.value === a)?.en ?? (a === "yes" ? "Yes" : a === "no" ? "No" : a)).join(", ")}</Badge>}
                  {!q.active && <Badge tone="neutral">Off</Badge>}
                </div>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <button disabled={pending || i === 0} onClick={() => run(() => moveApplicationQuestion(q.id, "up"))} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" aria-label="Move up"><ArrowUp size={14} /></button>
                  <button disabled={pending || i === questions.length - 1} onClick={() => run(() => moveApplicationQuestion(q.id, "down"))} className="rounded p-1 text-zinc-500 hover:bg-zinc-100 disabled:opacity-30" aria-label="Move down"><ArrowDown size={14} /></button>
                  <label className="ml-2 inline-flex items-center gap-1 text-xs text-zinc-600">
                    <input type="checkbox" checked={q.active} disabled={pending} onChange={(e) => run(() => setApplicationQuestionActive(q.id, e.target.checked))} /> On
                  </label>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {canManage && <AddQuestion jobId={jobId} />}
    </div>
  );
}

function AddQuestion({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("yes_no");
  const [labelEn, setEn] = useState("");
  const [labelFr, setFr] = useState("");
  const [required, setRequired] = useState(true);
  const [options, setOptions] = useState<Option[]>([]);
  const [knockout, setKnockout] = useState(false);
  const [pass, setPass] = useState<string[]>(["yes"]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const choices = kind === "yes_no" ? [{ value: "yes", en: "Yes" }, { value: "no", en: "No" }] : options;
  const reset = () => { setKind("yes_no"); setEn(""); setFr(""); setRequired(true); setOptions([]); setKnockout(false); setPass(["yes"]); setError(null); };

  const save = () =>
    start(async () => {
      setError(null);
      const res = await addApplicationQuestion({
        jobId,
        kind,
        labelEn,
        labelFr,
        required: required || knockout,
        options: kind === "single_select" ? options : [],
        passAnswers: knockout ? pass : null,
      });
      if ("error" in res) return setError(res.error ?? "Couldn't add the question.");
      setOpen(false);
      reset();
      router.refresh();
    });

  return (
    <>
      <Button size="sm" onClick={() => { reset(); setOpen(true); }}><Plus size={13} /> Add question</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add application question"
        footer={<><Button onClick={() => setOpen(false)}>Cancel</Button><Button variant="primary" disabled={pending} onClick={save}>Add question</Button></>}
      >
        <div className="space-y-3">
          <div>
            <label className={labelClass} htmlFor="q-kind">Type</label>
            <select id="q-kind" className={inputClass} value={kind} onChange={(e) => { const k = e.target.value as Kind; setKind(k); setPass(k === "yes_no" ? ["yes"] : []); if (k !== "yes_no" && k !== "single_select") setKnockout(false); }}>
              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="q-en">Question (English)</label>
            <input id="q-en" className={inputClass} value={labelEn} onChange={(e) => setEn(e.target.value)} placeholder="Are you legally entitled to work in Canada?" />
          </div>
          <div>
            <label className={labelClass} htmlFor="q-fr">Question (français)</label>
            <input id="q-fr" lang="fr-CA" className={inputClass} value={labelFr} onChange={(e) => setFr(e.target.value)} placeholder="Êtes-vous légalement autorisé(e) à travailler au Canada?" />
          </div>
          {kind === "single_select" && (
            <div>
              <span className={labelClass}>Choices (English / français)</span>
              <div className="space-y-1.5">
                {options.map((o, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input aria-label={`Choice ${i + 1} English`} className={inputClass} value={o.en} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, en: e.target.value, value: slug(e.target.value) } : x)))} />
                    <input aria-label={`Choice ${i + 1} French`} lang="fr-CA" className={inputClass} value={o.fr} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, fr: e.target.value } : x)))} />
                    <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="rounded p-1 text-zinc-400 hover:bg-zinc-100" aria-label={`Remove choice ${i + 1}`}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <Button size="sm" className="mt-2" onClick={() => setOptions([...options, { value: `option_${options.length + 1}`, en: "", fr: "" }])}><Plus size={13} /> Add choice</Button>
            </div>
          )}
          <label className="flex items-center gap-2"><input type="checkbox" checked={required || knockout} disabled={knockout} onChange={(e) => setRequired(e.target.checked)} /> Required</label>
          {(kind === "yes_no" || kind === "single_select") && (
            <div className="rounded-md border border-zinc-200 p-3">
              <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={knockout} onChange={(e) => setKnockout(e.target.checked)} /> Knockout question</label>
              {knockout && (
                <div className="mt-2">
                  <span className="text-xs text-zinc-600">Answers that pass (anything else archives the application):</span>
                  <div className="mt-1 flex flex-wrap gap-3">
                    {choices.map((c) => (
                      <label key={c.value} className="inline-flex items-center gap-1.5">
                        <input type="checkbox" checked={pass.includes(c.value)} onChange={(e) => setPass(e.target.checked ? [...pass, c.value] : pass.filter((p) => p !== c.value))} /> {c.en || c.value}
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {error && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-red-800">{error}</div>}
        </div>
      </Modal>
    </>
  );
}
