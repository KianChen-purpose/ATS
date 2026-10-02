"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateOfferLetter } from "@/server/actions/offer-letters";

/** Generate the letter from the current terms and download it for review before sending. */
export function PreviewLetterButton({ offerId }: { offerId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <>
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            try {
              const { fileId } = await generateOfferLetter(offerId);
              // A file download, not a page: trigger it with a temporary link.
              const a = document.createElement("a");
              a.href = `/api/files/${fileId}`;
              a.download = "";
              a.click();
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          })
        }
      >
        <FileText size={13} /> {pending ? "Preparing…" : "Preview letter"}
      </Button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}
