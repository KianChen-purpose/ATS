import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "pats_session";
// Candidate-facing and auth routes don't need a staff session.
// /api/odata authenticates with a feed token (Power BI), not a session cookie.
const PUBLIC_PREFIXES = ["/login", "/auth/", "/careers", "/schedule", "/api/public", "/api/odata", "/api/scim/", "/api/graph/", "/api/teams/messages", "/_next", "/favicon", "/robots.txt"];

/** Optimistic check only: real verification happens in requireUser(). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // A demo environment (synthetic data) is never indexed by search engines.
  const next = () => {
    const res = NextResponse.next();
    if (process.env.PATS_ENV === "demo") res.headers.set("X-Robots-Tag", "noindex, nofollow");
    return res;
  };
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    const login = new URL("/login", request.url);
    if (pathname !== "/") login.searchParams.set("next", pathname + request.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|svg|ico|jpg)$).*)"],
};
