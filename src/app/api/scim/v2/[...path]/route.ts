import type { NextRequest } from "next/server";
import * as scim from "@/server/services/scim";

/**
 * SCIM 2.0 endpoint for Microsoft Entra ID provisioning. Tenant URL: <APP_URL>/api/scim/v2,
 * secret token: a SCIM token from Settings → Integrations.
 */
const HEADERS = { "Content-Type": "application/scim+json", "Cache-Control": "no-store" };
type Ctx = RouteContext<"/api/scim/v2/[...path]">;

const json = (body: unknown, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: HEADERS });
const error = (e: scim.ScimError) => json({ schemas: [scim.SCIM_ERROR], status: String(e.status), scimType: e.scimType, detail: e.message }, e.status);

async function handle(req: NextRequest, ctx: Ctx) {
  try {
    await scim.authenticateScim(req.headers.get("authorization"));
    const [resource, id, ...rest] = (await ctx.params).path;
    if (rest.length) throw new scim.ScimError(404, "Not found.");
    const base = `${req.nextUrl.origin}/api/scim/v2`;
    const q = req.nextUrl.searchParams;
    const page = { start: Number(q.get("startIndex") ?? 1) || 1, count: Number(q.get("count") ?? 100) || 100 };
    const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await req.json().catch(() => null) : null;
    const list = (resources: unknown[], total: number) => ({ schemas: [scim.SCIM_LIST], totalResults: total, startIndex: page.start, itemsPerPage: resources.length, Resources: resources });

    if (resource === "ServiceProviderConfig" && req.method === "GET") {
      return json({
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        patch: { supported: true },
        bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
        filter: { supported: true, maxResults: 200 },
        changePassword: { supported: false },
        sort: { supported: false },
        etag: { supported: false },
        authenticationSchemes: [{ type: "oauthbearertoken", name: "OAuth Bearer Token", description: "PATS SCIM token" }],
      });
    }
    if (resource === "Users") {
      if (!id && req.method === "GET") {
        const { rows, total } = await scim.listUsers(q.get("filter"), page.start, page.count);
        return json(list(rows.map((u) => scim.userResource(u, base)), total));
      }
      if (!id && req.method === "POST") return json(scim.userResource(await scim.createUser(body), base), 201);
      if (id && req.method === "GET") return json(scim.userResource(await scim.getUser(id), base));
      if (id && req.method === "PUT") return json(scim.userResource(await scim.replaceUser(id, body), base));
      if (id && req.method === "PATCH") return json(scim.userResource(await scim.patchUser(id, body), base));
      if (id && req.method === "DELETE") {
        await scim.deleteUser(id);
        return json(null, 204);
      }
    }
    if (resource === "Groups") {
      if (!id && req.method === "GET") {
        const { rows, total } = await scim.listGroups(q.get("filter"), page.start, page.count);
        const withMembers = !/members/.test(q.get("excludedAttributes") ?? "");
        return json(list(await Promise.all(rows.map((g) => scim.groupResource(g, base, withMembers))), total));
      }
      if (!id && req.method === "POST") return json(await scim.groupResource(await scim.createGroup(body), base), 201);
      if (id && req.method === "GET") return json(await scim.groupResource(await scim.getGroup(id), base, !/members/.test(q.get("excludedAttributes") ?? "")));
      if (id && req.method === "PATCH") {
        await scim.patchGroup(id, body);
        return json(null, 204);
      }
      if (id && req.method === "DELETE") {
        await scim.deleteGroup(id);
        return json(null, 204);
      }
    }
    throw new scim.ScimError(404, "Not found.");
  } catch (e) {
    if (e instanceof scim.ScimError) return error(e);
    throw e;
  }
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
