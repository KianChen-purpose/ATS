"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { addNote } from "@/server/actions/applications";

export function NoteComposer({ candidateId, applicationId }: { candidateId: string; applicationId: string | null }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const submit = () =>
    start(async () => {
      await addNote(candidateId, applicationId, text);
      setText("");
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-zinc-200 bg-white focus-within:border-accent-500">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && text.trim() && submit()}
        placeholder="Add a note… use @Name to notify a teammate in Teams"
        className="block min-h-16 w-full resize-y rounded-t-lg px-3 py-2 outline-none"
      />
      <div className="flex items-center justify-between border-t border-zinc-100 px-2 py-1.5">
        <span className="text-[11px] text-zinc-400">⌘↵ to save</span>
        <Button size="sm" variant="primary" disabled={pending || !text.trim()} onClick={submit}>
          Add note
        </Button>
      </div>
    </div>
  );
}
