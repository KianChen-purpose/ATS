import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { markdownToHtml } from "@/lib/markdown";
import * as site from "@/server/services/career-site";
import { makeBrand, makeJob, resetDb } from "./fixtures";

async function job(brandId: string, o: Partial<typeof s.jobs.$inferInsert> = {}, title = "Analyst") {
  const { job: j } = await makeJob({ brandId, title });
  await db
    .update(s.jobs)
    .set({ status: "open", publishedOnCareerSite: true, confidential: false, openedAt: new Date("2026-09-01"), compMin: 90_000, compMax: 110_000, description: "## Role\n\nGreat role.\n\n- One\n- Two\n", ...o })
    .where(eq(s.jobs.id, j.id));
  return j;
}

describe("public career site", () => {
  beforeEach(resetDb);

  it("lists only open, published, non-confidential jobs for the brand", async () => {
    const brand = await makeBrand();
    const other = await makeBrand();
    const visible = await job(brand.id, {}, "Visible");
    await job(brand.id, { confidential: true }, "Secret");
    await job(brand.id, { status: "draft" }, "Draft");
    await job(brand.id, { status: "pending_approval" }, "Pending");
    await job(brand.id, { status: "closed" }, "Closed");
    await job(brand.id, { publishedOnCareerSite: false }, "Unpublished");
    await job(other.id, {}, "Other brand");

    const listed = await site.listPublicJobs(brand.id, "en");
    expect(listed.map((j) => j.title)).toEqual(["Visible"]);
    expect((await site.listPublicJobs(null, "en")).map((j) => j.title).sort()).toEqual(["Other brand", "Visible"]);
    expect(await site.getPublicJob(brand.slug, visible.id, "en")).toBeTruthy();
    expect(await site.getPublicJob(other.slug, visible.id, "en")).toBeNull(); // wrong brand in the URL
    const secret = await db.query.jobs.findFirst({ where: eq(s.jobs.title, "Secret") });
    expect(await site.getPublicJob(brand.slug, secret!.id, "en")).toBeNull();
    expect(await site.getPublicJob(brand.slug, "not-a-uuid", "en")).toBeNull();
  });

  it("serves the FR-CA translation when there is one, English otherwise", async () => {
    const brand = await makeBrand();
    const j = await job(brand.id, {}, "Portfolio Analyst");
    expect((await site.getPublicJob(brand.slug, j.id, "fr-CA"))?.descriptionLocale).toBe("en");
    await db.insert(s.jobTranslations).values({ jobId: j.id, locale: "fr-CA", title: "Analyste de portefeuille", description: "## Le poste" });
    const fr = await site.getPublicJob(brand.slug, j.id, "fr-CA");
    expect(fr).toMatchObject({ title: "Analyste de portefeuille", description: "## Le poste", descriptionLocale: "fr-CA" });
    expect((await site.listPublicJobs(brand.id, "fr-CA"))[0].title).toBe("Analyste de portefeuille");
    expect((await site.listPublicJobs(brand.id, "fr-CA", { q: "Analyste" })).length).toBe(1);
  });

  it("emits a JobPosting with salary, location and HTML description", async () => {
    const brand = await makeBrand();
    const j = await job(brand.id, { workplaceType: "remote", employmentType: "contract" });
    const ld = site.jobPostingJsonLd((await site.getPublicJob(brand.slug, j.id, "en"))!, "https://x/careers");
    expect(ld).toMatchObject({
      "@type": "JobPosting",
      employmentType: "CONTRACTOR",
      jobLocationType: "TELECOMMUTE",
      datePosted: "2026-09-01",
      baseSalary: { currency: "CAD", value: { minValue: 90_000, maxValue: 110_000, unitText: "YEAR" } },
    });
    expect(ld.description).toContain("<ul><li>One</li><li>Two</li></ul>");
  });

  it("only counts public roles on the brand index", async () => {
    const brand = await makeBrand();
    await job(brand.id);
    await job(brand.id, { confidential: true });
    const row = (await site.listCareerBrands()).find((b) => b.slug === brand.slug);
    expect(row?.openRoles).toBe(1);
  });
});

describe("markdown", () => {
  it("renders a trailing list and escapes HTML", () => {
    expect(markdownToHtml("- a\n- b\n")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(markdownToHtml("<script>x</script>")).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });
});
