"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setOfferLetterTemplateActive } from "@/server/actions/offer-letters";

export function TemplateActiveToggle({ templateId, active }: { templateId: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-zinc-600">
      <input
        type="checkbox"
        checked={active}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await setOfferLetterTemplateActive(templateId, e.target.checked);
            router.refresh();
          })
        }
      />
      Active
    </label>
  );
}
