import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "pats_session";
// Candidate-facing and auth routes don't need a staff session.
const PUBLIC_PREFIXES = ["/login", "/careers", "/api/public", "/_next", "/favicon"];

/** Optimistic check only: real verification happens in requireUser(). */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.(?:png|svg|ico|jpg)$).*)"],
};
