import { NextResponse, type NextRequest } from "next/server";
import { createSession } from "@/lib/session";
import { finishSignIn, SignInError } from "@/server/services/entra-auth";

const FLOW_COOKIE = "pats_entra_flow";

/** Entra redirects here with ?code&state (or ?error). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const fail = (code: string) => {
    const res = NextResponse.redirect(new URL(`/login?error=${code}`, req.url));
    res.cookies.delete({ name: FLOW_COOKIE, path: "/auth" });
    return res;
  };
  if (p.get("error")) return fail(p.get("error") === "access_denied" ? "denied" : "token");
  try {
    const { user, next } = await finishSignIn({
      code: p.get("code"),
      state: p.get("state"),
      flowCookie: req.cookies.get(FLOW_COOKIE)?.value,
      request: {
        requestId: req.headers.get("x-request-id") ?? crypto.randomUUID(),
        ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
        userAgent: req.headers.get("user-agent")?.slice(0, 500) ?? null,
      },
    });
    await createSession(user.id);
    const res = NextResponse.redirect(new URL(next, req.url));
    res.cookies.delete({ name: FLOW_COOKIE, path: "/auth" });
    return res;
  } catch (e) {
    if (e instanceof SignInError) return fail(e.code);
    throw e;
  }
}
