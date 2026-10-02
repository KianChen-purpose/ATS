import type { NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/session";
import { ForbiddenError, NotFoundError } from "@/server/policy";
import { downloadFile } from "@/server/services/files";

/** Download a stored file. Authorization and the export audit row live in the files service. */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/files/[id]">) {
  const actor = await getActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  const id = z.string().uuid().safeParse((await ctx.params).id);
  if (!id.success) return new Response("Not found", { status: 404 });
  try {
    const { file, bytes } = await downloadFile(actor, id.data);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
