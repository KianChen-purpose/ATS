import Link from "next/link";
import { Suspense } from "react";
import { t, langParam, type CareerLocale } from "@/lib/i18n/careers";
import { LanguageToggle } from "./language-toggle";

/** Public career site frame: brand header, language switch, Purpose Unlimited footer. */
export function CareerShell({ brand, locale, children }: { brand: { name: string; slug: string }; locale: CareerLocale; children: React.ReactNode }) {
  const tr = t(locale);
  return (
    <div lang={locale} className="min-h-full bg-canvas text-black">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:rounded focus:bg-white focus:px-3 focus:py-2">
        {locale === "fr-CA" ? "Aller au contenu" : "Skip to content"}
      </a>
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4 sm:px-6">
          <Link href={`/careers/${brand.slug}?lang=${langParam(locale)}`} className="font-display text-xl">
            {brand.name}
          </Link>
          <Suspense>
            <LanguageToggle current={locale} label={tr.language} />
          </Suspense>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-4xl px-4 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-4xl px-4 pb-10 text-xs text-zinc-600 sm:px-6">{tr.partOf}</footer>
    </div>
  );
}
