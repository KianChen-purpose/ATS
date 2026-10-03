/** Demo environments are never indexed; otherwise only the career sites are. */
export const dynamic = "force-dynamic";

export function GET() {
  const body = process.env.PATS_ENV === "demo" ? "User-agent: *\nDisallow: /\n" : "User-agent: *\nAllow: /careers\nDisallow: /\n";
  return new Response(body, { headers: { "Content-Type": "text/plain" } });
}
