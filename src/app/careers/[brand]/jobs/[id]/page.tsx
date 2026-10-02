import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { careerLocale, formatPay, langParam, t } from "@/lib/i18n/careers";
import { markdownToHtml } from "@/lib/markdown";
import { getPublicJob, jobPostingJsonLd } from "@/server/services/career-site";
import { CareerShell } from "@/components/careers/career-shell";

export async function generateMetadata(props: PageProps<"/careers/[brand]/jobs/[id]">) {
  const [{ brand, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const job = await getPublicJob(brand, id, careerLocale(sp.lang));
  if (!job) return { title: "Careers" };
  const path = `/careers/${brand}/jobs/${id}`;
  return {
    title: { absolute: `${job.title} · ${job.brand.name}` },
    alternates: { canonical: path, languages: { en: `${path}?lang=en`, "fr-CA": `${path}?lang=fr` } },
  };
}

export default async function PublicJobPage(props: PageProps<"/careers/[brand]/jobs/[id]">) {
  const [{ brand, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const locale = careerLocale(sp.lang);
  const tr = t(locale);
  const job = await getPublicJob(brand, id, locale);
  if (!job) notFound();
  const pay = formatPay(job.compMin, job.compMax, job.currency, locale);
  const base = process.env.APP_URL ?? "http://localhost:3000";
  // JSON in a script tag: escape "<" so a description can't close the tag.
  const jsonLd = JSON.stringify(jobPostingJsonLd(job, `${base}/careers/${brand}/jobs/${id}`)).replace(/</g, "\\u003c");

  return (
    <CareerShell brand={job.brand} locale={locale}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <Link href={`/careers/${brand}?lang=${langParam(locale)}`} className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ChevronLeft size={14} aria-hidden /> {tr.backToJobs}
      </Link>
      <h1 className="mt-3 text-3xl">{job.title}</h1>
      <p className="mt-2 flex flex-wrap gap-x-3 text-zinc-700">
        {job.department && <span>{job.department}</span>}
        {job.location && <span>{job.location.name}</span>}
        <span>{tr.workplace[job.workplaceType]}</span>
        <span>{tr.employment[job.employmentType]}</span>
      </p>
      {pay && (
        <p className="mt-4 inline-block rounded-md border border-zinc-300 bg-white px-3 py-2">
          <span className="text-sm text-zinc-700">{tr.salary} </span>
          <span className="font-medium">{pay}</span> <span className="text-sm text-zinc-700">{tr.perYear}</span>
        </p>
      )}
      <div className="mt-6">
        <Link href={`/careers/${brand}/jobs/${id}/apply?lang=${langParam(locale)}`} className="inline-flex h-11 items-center rounded-md bg-black px-5 font-medium text-[var(--pats-ivory)] hover:bg-zinc-800">
          {tr.apply}
        </Link>
      </div>
      <article lang={job.descriptionLocale} className="prose-job mt-8 rounded-lg border border-zinc-300 bg-white p-6 text-[15px]" dangerouslySetInnerHTML={{ __html: markdownToHtml(job.description) }} />
      <div className="mt-6">
        <Link href={`/careers/${brand}/jobs/${id}/apply?lang=${langParam(locale)}`} className="inline-flex h-11 items-center rounded-md bg-black px-5 font-medium text-[var(--pats-ivory)] hover:bg-zinc-800">
          {tr.apply}
        </Link>
      </div>
    </CareerShell>
  );
}
