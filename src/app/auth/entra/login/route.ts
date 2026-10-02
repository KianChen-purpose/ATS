import { NextResponse, type NextRequest } from "next/server";
import { SignInError, startSignIn } from "@/server/services/entra-auth";

const FLOW_COOKIE = "pats_entra_flow";

/** Starts Microsoft sign-in: redirect to Entra with PKCE, state and nonce. */
export async function GET(req: NextRequest) {
  try {
    const { url, flowCookie, maxAge } = await startSignIn(req.nextUrl.searchParams.get("next"));
    const res = NextResponse.redirect(url);
    res.cookies.set(FLOW_COOKIE, flowCookie, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/auth", maxAge });
    return res;
  } catch (e) {
    if (e instanceof SignInError) return NextResponse.redirect(new URL(`/login?error=${e.code}`, req.url));
    throw e;
  }
}
