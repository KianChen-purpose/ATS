import "server-only";
import { and, asc, eq, ilike, sql, type SQL } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { CareerLocale } from "@/lib/i18n/careers";
import { markdownToHtml } from "@/lib/markdown";

/**
 * Public career sites (PRD §4.7). Everything here is unauthenticated, so it returns only what a
 * job posting shows: jobs that are open, published and not confidential, and never any
 * candidate, hiring-team or internal data.
 */

const publicJob = and(eq(s.jobs.status, "open"), eq(s.jobs.publishedOnCareerSite, true), eq(s.jobs.confidential, false))!;

export async function getCareerBrand(slug: string) {
  const brand = await db.query.brands.findFirst({ where: eq(s.brands.slug, slug) });
  if (!brand) return null;
  return { id: brand.id, name: brand.name, slug: brand.slug, tagline: brand.tagline, websiteUrl: brand.websiteUrl, primaryColor: brand.primaryColor };
}

export type PublicJobFilters = { department?: string; location?: string; q?: string };

/** Open roles for a brand (or every brand when slug is null), in the requested language. */
export async function listPublicJobs(brandId: string | null, locale: CareerLocale, f: PublicJobFilters = {}) {
  const where: SQL[] = [publicJob];
  if (brandId) where.push(eq(s.jobs.brandId, brandId));
  if (f.department) where.push(eq(s.departments.id, f.department));
  if (f.location) where.push(eq(s.locations.id, f.location));
  if (f.q) where.push(sql`(${ilike(s.jobs.title, `%${f.q}%`)} OR ${ilike(s.jobTranslations.title, `%${f.q}%`)})`);
  const rows = await db
    .select({
      id: s.jobs.id,
      title: s.jobs.title,
      titleFr: s.jobTranslations.title,
      brand: s.brands.name,
      brandSlug: s.brands.slug,
      departmentId: s.departments.id,
      department: s.departments.name,
      locationId: s.locations.id,
      location: s.locations.name,
      workplaceType: s.jobs.workplaceType,
      employmentType: s.jobs.employmentType,
      compMin: s.jobs.compMin,
      compMax: s.jobs.compMax,
      currency: s.jobs.currency,
      openedAt: s.jobs.openedAt,
    })
    .from(s.jobs)
    .innerJoin(s.brands, eq(s.brands.id, s.jobs.brandId))
    .leftJoin(s.departments, eq(s.departments.id, s.jobs.departmentId))
    .leftJoin(s.locations, eq(s.locations.id, s.jobs.locationId))
    .leftJoin(s.jobTranslations, and(eq(s.jobTranslations.jobId, s.jobs.id), eq(s.jobTranslations.locale, "fr-CA")))
    .where(and(...where))
    .orderBy(asc(s.departments.name), asc(s.jobs.title));
  return rows.map(({ titleFr, ...r }) => ({ ...r, title: locale === "fr-CA" && titleFr ? titleFr : r.title }));
}

export type PublicJobRow = Awaited<ReturnType<typeof listPublicJobs>>[number];

/** One open posting with its description in the requested language (English if not translated). */
export async function getPublicJob(brandSlug: string, jobId: string, locale: CareerLocale) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return null;
  const job = await db.query.jobs.findFirst({
    where: and(eq(s.jobs.id, jobId), publicJob),
    with: { brand: true, department: true, location: true, translations: true },
  });
  if (!job || job.brand.slug !== brandSlug) return null;
  const fr = job.translations.find((tr) => tr.locale === "fr-CA");
  const translated = locale === "fr-CA" && fr;
  return {
    id: job.id,
    title: translated ? fr.title : job.title,
    description: (translated ? fr.description : job.description) ?? "",
    descriptionLocale: translated ? ("fr-CA" as const) : ("en" as const),
    brand: { name: job.brand.name, slug: job.brand.slug, websiteUrl: job.brand.websiteUrl, primaryColor: job.brand.primaryColor },
    department: job.department?.name ?? null,
    location: job.location ? { name: job.location.name, city: job.location.city, region: job.location.region, country: job.location.country } : null,
    workplaceType: job.workplaceType,
    employmentType: job.employmentType,
    compMin: job.compMin,
    compMax: job.compMax,
    currency: job.currency,
    openedAt: job.openedAt,
  };
}

export type PublicJob = NonNullable<Awaited<ReturnType<typeof getPublicJob>>>;

/** Filter options for a brand's site: only teams and places that have open roles. */
export function filterOptions(jobs: PublicJobRow[]) {
  const uniq = <T extends { id: string | null; name: string | null }>(xs: T[]) =>
    [...new Map(xs.filter((x) => x.id && x.name).map((x) => [x.id!, x.name!])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    departments: uniq(jobs.map((j) => ({ id: j.departmentId, name: j.department }))),
    locations: uniq(jobs.map((j) => ({ id: j.locationId, name: j.location }))),
  };
}

/** schema.org JobPosting for Google for Jobs (PRD §4.7). */
export function jobPostingJsonLd(job: PublicJob, url: string) {
  const type = { full_time: "FULL_TIME", part_time: "PART_TIME", contract: "CONTRACTOR", intern: "INTERN" }[job.employmentType];
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: markdownToHtml(job.description),
    identifier: { "@type": "PropertyValue", name: job.brand.name, value: job.id },
    datePosted: job.openedAt?.toISOString().slice(0, 10),
    employmentType: type,
    hiringOrganization: { "@type": "Organization", name: job.brand.name, ...(job.brand.websiteUrl ? { sameAs: job.brand.websiteUrl } : {}) },
    directApply: true,
    url,
    ...(job.workplaceType === "remote"
      ? { jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "Canada" } }
      : {
          jobLocation: {
            "@type": "Place",
            address: { "@type": "PostalAddress", addressLocality: job.location?.city ?? undefined, addressRegion: job.location?.region ?? undefined, addressCountry: "CA" },
          },
        }),
    ...(job.compMin != null || job.compMax != null
      ? {
          baseSalary: {
            "@type": "MonetaryAmount",
            currency: job.currency,
            value: { "@type": "QuantitativeValue", minValue: job.compMin ?? job.compMax, maxValue: job.compMax ?? job.compMin, unitText: "YEAR" },
          },
        }
      : {}),
  };
}

/** Every brand with its number of open public roles, for the Purpose Unlimited careers index. */
export async function listCareerBrands() {
  return db
    .select({
      name: s.brands.name,
      slug: s.brands.slug,
      // Qualified: Drizzle renders columns unqualified in single-table selects.
      openRoles: sql<number>`(SELECT count(*)::int FROM jobs j WHERE j.brand_id = ${sql.raw('"brands"."id"')} AND j.status = 'open' AND j.published_on_career_site AND NOT j.confidential)`,
    })
    .from(s.brands)
    .orderBy(asc(s.brands.name));
}
