import { Download } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { qs } from "./report-page";

/** Excel and CSV download links for the current report; the export is audited server-side. */
export function ExportLinks({ params }: { params: Record<string, string | undefined> }) {
  return (
    <span className="flex items-center gap-1" aria-label="Export">
      <a href={`/api/reports/export${qs({ ...params, format: "xlsx" })}`} className={buttonClass("secondary", "sm")} download>
        <Download size={13} /> Excel
      </a>
      <a href={`/api/reports/export${qs({ ...params, format: "csv" })}`} className={buttonClass("ghost", "sm")} download>
        CSV
      </a>
    </span>
  );
}
