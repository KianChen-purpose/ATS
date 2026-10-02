import type { NextRequest } from "next/server";
import { careerLocale, formatPay } from "@/lib/i18n/careers";
import { PUBLIC_LIMITS, RateLimitError, rateLimit } from "@/server/security/rate-limit";
import { getCareerBrand, listPublicJobs } from "@/server/services/career-site";

/**
 * Public job board feed for brand websites (PRD §4.7 "embeddable job board").
 * GET /api/public/jobs?brand=steadyhand&lang=fr — published, open, non-confidential roles only.
 */
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  try {
    rateLimit(`jobs-api:${ip}`, PUBLIC_LIMITS.view);
  } catch (e) {
    if (e instanceof RateLimitError) return Response.json({ error: e.message }, { status: 429, headers: CORS });
    throw e;
  }
  const params = req.nextUrl.searchParams;
  const locale = careerLocale(params.get("lang") ?? undefined);
  const slug = params.get("brand");
  const brand = slug ? await getCareerBrand(slug) : null;
  if (slug && !brand) return Response.json({ error: "Unknown brand" }, { status: 404, headers: CORS });

  const base = process.env.APP_URL ?? req.nextUrl.origin;
  const lang = locale === "fr-CA" ? "fr" : "en";
  const jobs = (await listPublicJobs(brand?.id ?? null, locale)).map((j) => ({
    id: j.id,
    title: j.title,
    brand: j.brand,
    department: j.department,
    location: j.location,
    workplaceType: j.workplaceType,
    employmentType: j.employmentType,
    salary: j.compMin != null || j.compMax != null ? { min: j.compMin, max: j.compMax, currency: j.currency, display: formatPay(j.compMin, j.compMax, j.currency, locale) } : null,
    postedAt: j.openedAt,
    url: `${base}/careers/${j.brandSlug}/jobs/${j.id}?lang=${lang}`,
  }));
  return Response.json({ locale, jobs }, { headers: { ...CORS, "Cache-Control": "public, max-age=300" } });
}
