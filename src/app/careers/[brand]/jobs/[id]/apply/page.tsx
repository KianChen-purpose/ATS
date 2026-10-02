import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { careerLocale, langParam, t } from "@/lib/i18n/careers";
import { getPublicJob } from "@/server/services/career-site";
import { publicQuestions } from "@/server/services/application-forms";
import { CareerShell } from "@/components/careers/career-shell";
import { ApplyForm } from "@/components/careers/apply-form";

export async function generateMetadata(props: PageProps<"/careers/[brand]/jobs/[id]/apply">) {
  const [{ brand, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const locale = careerLocale(sp.lang);
  const job = await getPublicJob(brand, id, locale);
  return { title: { absolute: job ? `${t(locale).form.title(job.title)} · ${job.brand.name}` : "Careers" }, robots: { index: false } };
}

export default async function ApplyPage(props: PageProps<"/careers/[brand]/jobs/[id]/apply">) {
  const [{ brand, id }, sp] = await Promise.all([props.params, props.searchParams]);
  const locale = careerLocale(sp.lang);
  const job = await getPublicJob(brand, id, locale);
  if (!job) notFound();
  const questions = await publicQuestions(job.id);
  return (
    <CareerShell brand={job.brand} locale={locale}>
      <Link href={`/careers/${brand}/jobs/${id}?lang=${langParam(locale)}`} className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline">
        <ChevronLeft size={14} aria-hidden /> {job.title}
      </Link>
      <h1 className="mt-3 mb-6 text-3xl">{t(locale).form.title(job.title)}</h1>
      <ApplyForm jobId={job.id} jobTitle={job.title} brand={job.brand.name} locale={locale} questions={questions} />
    </CareerShell>
  );
}
