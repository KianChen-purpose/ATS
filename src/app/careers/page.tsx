import Link from "next/link";
import { careerLocale, langParam, t } from "@/lib/i18n/careers";
import { listCareerBrands } from "@/server/services/career-site";

export const metadata = { title: { absolute: "Careers at Purpose Unlimited" } };

export default async function CareersIndex(props: PageProps<"/careers">) {
  const locale = careerLocale((await props.searchParams).lang);
  const tr = t(locale);
  const brands = await listCareerBrands();
  return (
    <div lang={locale} className="min-h-full bg-canvas">
      <main id="main" className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <h1 className="text-3xl">{tr.careersAt("Purpose Unlimited")}</h1>
        <ul className="mt-6 grid gap-3 sm:grid-cols-2">
          {brands.map((b) => (
            <li key={b.slug}>
              <Link href={`/careers/${b.slug}?lang=${langParam(locale)}`} className="block rounded-lg border border-zinc-300 bg-white p-4 hover:border-black">
                <span className="block font-display text-lg">{b.name}</span>
                <span className="text-sm text-zinc-700">{tr.openRoles(b.openRoles)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
