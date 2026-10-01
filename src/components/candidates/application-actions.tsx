"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArchiveRestore, ChevronDown, ChevronRight, Mail, Archive } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, inputClass, labelClass } from "@/components/ui/modal";
import { archiveApplications, moveToStage, sendCandidateEmail, unarchiveApplication } from "@/server/actions/applications";
import { renderTemplate } from "@/lib/templates";

type Stage = { id: string; name: string; type: string; position: number };
type Template = { id: string; name: string; subject: string; body: string };

export type ActionContext = {
  candidate: { id: string; firstName: string; lastName: string; email: string | null };
  application: { id: string; status: string; stageId: string; jobTitle: string; brandName: string } | null;
  stages: Stage[];
  archiveReasons: { id: string; name: string; category: string }[];
  templates: Template[];
  sender: { name: string; email: string };
  canManage: boolean;
};

export function ApplicationActions(ctx: ActionContext) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [menu, setMenu] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const app = ctx.application;
  const current = ctx.stages.find((s) => s.id === app?.stageId);
  const next = current ? ctx.stages.find((s) => s.position === current.position + 1) : undefined;

  const run = (fn: () => Promise<unknown>) =>
    start(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        alert((e as Error).message);
      }
    });

  if (!ctx.canManage) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {app && app.status === "active" && (
        <>
          {next && (
            <Button variant="primary" disabled={pending} onClick={() => run(() => moveToStage([app.id], next.id))} title={`Move to ${next.name}`}>
              Advance to {next.name} <ChevronRight size={14} />
            </Button>
          )}
          <div className="relative">
            <Button disabled={pending} onClick={() => setMenu((m) => !m)}>
              Move to stage <ChevronDown size={14} />
            </Button>
            {menu && (
              <div className="absolute left-0 z-20 mt-1 w-56 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
                {ctx.stages.map((s) => (
                  <button
                    key={s.id}
                    disabled={s.id === app.stageId}
                    onClick={() => {
                      setMenu(false);
                      run(() => moveToStage([app.id], s.id));
                    }}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 disabled:font-semibold disabled:text-accent-700"
                  >
                    {s.name}
                    {s.id === app.stageId && <span className="text-[11px]">Current</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button disabled={pending} onClick={() => setArchiveOpen(true)}>
            <Archive size={14} /> Archive
          </Button>
        </>
      )}
      {app && app.status === "archived" && (
        <Button disabled={pending} onClick={() => run(() => unarchiveApplication(app.id))}>
          <ArchiveRestore size={14} /> Unarchive
        </Button>
      )}
      <Button disabled={pending || !ctx.candidate.email} onClick={() => setEmailOpen(true)}>
        <Mail size={14} /> Email
      </Button>

      {app && (
        <ArchiveDialog
          open={archiveOpen}
          onClose={() => setArchiveOpen(false)}
          ctx={ctx}
          onSubmit={(reasonId, email) =>
            run(async () => {
              await archiveApplications({ applicationIds: [app.id], reasonId, sendEmail: !!email, emailSubject: email?.subject, emailBody: email?.body });
              setArchiveOpen(false);
            })
          }
          pending={pending}
        />
      )}
      <EmailDialog
        open={emailOpen}
        onClose={() => setEmailOpen(false)}
        ctx={ctx}
        pending={pending}
        onSend={(subject, body) =>
          run(async () => {
            await sendCandidateEmail({ candidateId: ctx.candidate.id, applicationId: app?.id ?? null, subject, body });
            setEmailOpen(false);
          })
        }
      />
    </div>
  );
}

function mergeVars(ctx: ActionContext) {
  return {
    candidate: { firstName: ctx.candidate.firstName, lastName: ctx.candidate.lastName },
    job: { title: ctx.application?.jobTitle ?? "" },
    brand: { name: ctx.application?.brandName ?? "Purpose" },
    sender: { name: ctx.sender.name },
  };
}

function ArchiveDialog({
  open,
  onClose,
  ctx,
  onSubmit,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  ctx: ActionContext;
  onSubmit: (reasonId: string, email: { subject: string; body: string } | null) => void;
  pending: boolean;
}) {
  const rejection = ctx.templates.find((t) => t.name.toLowerCase().startsWith("rejection"));
  const [reasonId, setReasonId] = useState(ctx.archiveReasons[0]?.id ?? "");
  const [notify, setNotify] = useState(true);
  const [subject, setSubject] = useState(rejection?.subject ?? "");
  const [body, setBody] = useState(rejection?.body ?? "");
  const reason = ctx.archiveReasons.find((r) => r.id === reasonId);
  const canEmail = !!ctx.candidate.email && reason?.category === "rejected";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Archive ${ctx.candidate.firstName} ${ctx.candidate.lastName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !reasonId} onClick={() => onSubmit(reasonId, canEmail && notify ? { subject, body } : null)}>
            {canEmail && notify ? "Archive & send email" : "Archive"}
          </Button>
        </>
      }
    >
      <label className={labelClass}>Reason</label>
      <select className={inputClass} value={reasonId} onChange={(e) => setReasonId(e.target.value)}>
        {["rejected", "withdrew", "other"].map((cat) => (
          <optgroup key={cat} label={cat === "rejected" ? "Rejected by us" : cat === "withdrew" ? "Candidate withdrew" : "Other"}>
            {ctx.archiveReasons.filter((r) => r.category === cat).map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </optgroup>
        ))}
      </select>
      {canEmail && (
        <div className="mt-4 space-y-2">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            Send rejection email via Outlook
          </label>
          {notify && (
            <>
              <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} />
              <textarea className={`${inputClass} min-h-32`} value={body} onChange={(e) => setBody(e.target.value)} />
              <p className="text-[11px] text-zinc-500">
                Preview: {renderTemplate(subject, mergeVars(ctx))}
              </p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

function EmailDialog({
  open,
  onClose,
  ctx,
  onSend,
  pending,
}: {
  open: boolean;
  onClose: () => void;
  ctx: ActionContext;
  onSend: (subject: string, body: string) => void;
  pending: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const applyTemplate = (id: string) => {
    const t = ctx.templates.find((x) => x.id === id);
    if (!t) return;
    setSubject(renderTemplate(t.subject, mergeVars(ctx)));
    setBody(renderTemplate(t.body, mergeVars(ctx)));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New email"
      className="max-w-2xl"
      footer={
        <>
          <span className="mr-auto self-center text-[11px] text-zinc-500">Sends from {ctx.sender.email} via Outlook</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={pending || !subject || !body} onClick={() => onSend(subject, body)}>
            Send
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-zinc-600">
          <span className="w-12 text-xs">To</span>
          <span className="rounded bg-zinc-100 px-2 py-0.5">{ctx.candidate.email}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-12 text-xs text-zinc-600">Template</span>
          <select className={inputClass} defaultValue="" onChange={(e) => applyTemplate(e.target.value)}>
            <option value="" disabled>Choose a template…</option>
            {ctx.templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        <input className={inputClass} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <textarea className={`${inputClass} min-h-48`} placeholder="Write your message…" value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
    </Modal>
  );
}
