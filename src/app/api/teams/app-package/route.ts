import { getActor } from "@/lib/session";
import { ForbiddenError } from "@/server/policy";
import { teamsAppPackage } from "@/server/services/teams-app";

/** Download the Teams app package (admins), to upload in the Teams admin center. */
export async function GET() {
  const actor = await getActor();
  if (!actor) return new Response("Sign in required", { status: 401 });
  try {
    const bytes = teamsAppPackage(actor);
    return new Response(new Uint8Array(bytes), {
      headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="pats-teams-app.zip"', "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw e;
  }
}
