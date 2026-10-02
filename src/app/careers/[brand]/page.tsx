import Link from "next/link";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { careerLocale, formatPay, langParam, t } from "@/lib/i18n/careers";
import { filterOptions, getCareerBrand, listPublicJobs } from "@/server/services/career-site";
import { CareerShell } from "@/components/careers/career-shell";

export async function generateMetadata(props: PageProps<"/careers/[brand]">) {
  const [{ brand: slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const brand = await getCareerBrand(slug);
  if (!brand) return { title: "Careers" };
  const locale = careerLocale(sp.lang);
  return {
    title: { absolute: t(locale).careersAt(brand.name) },
    description: brand.tagline ?? undefined,
    alternates: { languages: { en: `/careers/${slug}?lang=en`, "fr-CA": `/careers/${slug}?lang=fr` } },
  };
}

export default async function CareerSitePage(props: PageProps<"/careers/[brand]">) {
  const [{ brand: slug }, sp] = await Promise.all([props.params, props.searchParams]);
  const brand = await getCareerBrand(slug);
  if (!brand) notFound();
  const locale = careerLocale(sp.lang);
  const tr = t(locale);
  const str = (k: string) => (typeof sp[k] === "string" && sp[k] ? (sp[k] as string) : undefined);
  const filters = { department: str("team"), location: str("location"), q: str("q") };

  const [all, jobs] = await Promise.all([listPublicJobs(brand.id, locale), listPublicJobs(brand.id, locale, filters)]);
  const opts = filterOptions(all);
  const groups = new Map<string, typeof jobs>();
  for (const j of jobs) groups.set(j.department ?? "—", [...(groups.get(j.department ?? "—") ?? []), j]);

  return (
    <CareerShell brand={brand} locale={locale}>
      <h1 className="text-3xl">{tr.careersAt(brand.name)}</h1>
      {brand.tagline && locale === "en" && <p className="mt-1 text-zinc-700">{brand.tagline}</p>}

      <form className="mt-6 flex flex-wrap items-end gap-2" role="search">
        <input type="hidden" name="lang" value={langParam(locale)} />
        <label className="flex flex-col text-xs font-medium text-zinc-700">
          {tr.search}
          <input name="q" defaultValue={filters.q} className="mt-1 h-10 w-56 rounded-md border border-zinc-400 bg-white px-3 text-sm" />
        </label>
        <label className="flex flex-col text-xs font-medium text-zinc-700">
          {tr.team}
          <select name="team" defaultValue={filters.department ?? ""} className="mt-1 h-10 rounded-md border border-zinc-400 bg-white px-2 text-sm">
            <option value="">{tr.allDepartments}</option>
            {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-xs font-medium text-zinc-700">
          {tr.location}
          <select name="location" defaultValue={filters.location ?? ""} className="mt-1 h-10 rounded-md border border-zinc-400 bg-white px-2 text-sm">
            <option value="">{tr.allLocations}</option>
            {opts.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </label>
        <button className="h-10 rounded-md bg-black px-4 text-sm font-medium text-[var(--pats-ivory)] hover:bg-zinc-800">{tr.filter}</button>
      </form>

      <p className="mt-6 text-sm text-zinc-700" aria-live="polite">{tr.openRoles(jobs.length)}</p>
      {jobs.length === 0 ? (
        <p className="mt-4 rounded-lg border border-zinc-300 bg-white p-6 text-zinc-700">{tr.noRoles}</p>
      ) : (
        <div className="mt-2 space-y-6">
          {[...groups.entries()].map(([dept, items]) => (
            <section key={dept} aria-labelledby={`dept-${dept}`}>
              <h2 id={`dept-${dept}`} className="mb-2 text-lg">{dept}</h2>
              <ul className="divide-y divide-zinc-200 overflow-hidden rounded-lg border border-zinc-300 bg-white">
                {items.map((j) => {
                  const pay = formatPay(j.compMin, j.compMax, j.currency, locale);
                  return (
                    <li key={j.id}>
                      <Link href={`/careers/${brand.slug}/jobs/${j.id}?lang=${langParam(locale)}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-zinc-50 focus-visible:bg-zinc-50">
                        <span>
                          <span className="block text-base font-medium underline-offset-2 hover:underline">{j.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 text-sm text-zinc-700">
                            {j.location && <span className="inline-flex items-center gap-1"><MapPin size={13} aria-hidden /> {j.location}</span>}
                            <span>{tr.workplace[j.workplaceType]}</span>
                            <span>{tr.employment[j.employmentType]}</span>
                          </span>
                        </span>
                        {pay && <span className="text-sm text-zinc-800">{pay}</span>}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </CareerShell>
  );
}
