"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inputClass, labelClass } from "@/components/ui/modal";
import { createFeedTokenAction, revokeFeedTokenAction } from "@/server/actions/reports";

export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-1.5">
      <input readOnly aria-label={label} value={value} className={`${inputClass} font-mono text-xs`} onFocus={(e) => e.target.select()} />
      <Button
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => {
          navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </Button>
    </div>
  );
}

export function NewFeedToken() {
  const [name, setName] = useState("Power BI");
  const [days, setDays] = useState(90);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (token)
    return (
      <div className="space-y-2 rounded-md border border-zinc-300 bg-zinc-50 p-3" role="status">
        <p className="text-[13px] font-medium">Copy your token now. It won&apos;t be shown again.</p>
        <CopyField value={token} label="Feed token" />
        <Button size="sm" variant="ghost" onClick={() => setToken(null)}>
          Done
        </Button>
      </div>
    );
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createFeedTokenAction({ name, days });
          if ("error" in r) setError(r.error);
          else setToken(r.token);
        });
      }}
    >
      <label className="block">
        <span className={labelClass}>Token name</span>
        <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
      </label>
      <label className="block">
        <span className={labelClass}>Expires after</span>
        <select className={inputClass} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {d} days
            </option>
          ))}
        </select>
      </label>
      <Button variant="primary" type="submit" disabled={pending || name.trim().length < 2}>
        <KeyRound size={14} /> Create token
      </Button>
      {error && <p className="w-full text-xs text-red-700">{error}</p>}
    </form>
  );
}

export function RevokeToken({ id, name }: { id: string; name: string }) {
  const [pending, start] = useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        if (confirm(`Revoke “${name}”? Anything refreshing with it will stop working.`)) start(() => revokeFeedTokenAction(id).then(() => {}));
      }}
    >
      Revoke
    </Button>
  );
}
