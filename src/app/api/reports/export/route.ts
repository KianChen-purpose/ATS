import type { NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { decodeDefinitionStrict, InvalidDefinitionError } from "@/server/services/reports/builder";
import { drillSchema } from "@/server/services/reports/drilldown";
import { exportBuilderRecords, exportBuilderReport, exportDrillRecords } from "@/server/services/reports/export";
import { resolveFilters } from "@/server/services/reports/filters";
import { getSavedReport } from "@/server/services/reports/saved";

const querySchema = z.object({
  kind: z.enum(["builder", "records", "drill", "saved"]),
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
  q: z.string().max(4000).optional(),
  k: z.string().max(1000).optional(),
  id: z.uuid().optional(),
});

/**
 * Download a report as CSV or Excel. The same filters and access rules as the screen apply, and
 * the export service writes the audit row.
 */
export async function GET(req: NextRequest) {
  const actor = await getActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  const params = Object.fromEntries(req.nextUrl.searchParams);
  const parsed = querySchema.safeParse(params);
  if (!parsed.success) return new Response("Bad request", { status: 400 });
  const { kind, format, q, k, id } = parsed.data;
  const f = resolveFilters(actor, params);
  try {
    let file;
    if (kind === "builder" || kind === "records") {
      if (!q) return new Response("Bad request", { status: 400 });
    }
    if (kind === "builder") file = await exportBuilderReport(actor, decodeDefinitionStrict(q!), f, format);
    else if (kind === "saved") {
      if (!id) return new Response("Bad request", { status: 400 });
      const report = await getSavedReport(actor, id);
      file = await exportBuilderReport(actor, report.definition, f, format, { name: report.name, savedReportId: report.id });
    } else if (kind === "records") {
      const keys = z.array(z.string().max(300)).max(2).safeParse(JSON.parse(k ?? "[]"));
      if (!keys.success) return new Response("Bad request", { status: 400 });
      file = await exportBuilderRecords(actor, decodeDefinitionStrict(q!), f, keys.data, format);
    } else {
      const set = drillSchema.safeParse(params);
      if (!set.success) return new Response("Bad request", { status: 400 });
      file = await exportDrillRecords(actor, f, set.data, format);
    }
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(file.bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof SyntaxError || e instanceof InvalidDefinitionError) return new Response("Bad request", { status: 400 });
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response(e.message, { status: 403 });
    throw e;
  }
}
