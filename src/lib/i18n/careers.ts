/** Candidate-facing career site strings (ARCHITECTURE.md §7.2: EN and FR-CA). */
export type CareerLocale = "en" | "fr-CA";

export function careerLocale(lang: string | string[] | undefined): CareerLocale {
  return lang === "fr" || lang === "fr-CA" ? "fr-CA" : "en";
}

/** Query-string value for a locale in career-site URLs. */
export const langParam = (l: CareerLocale) => (l === "fr-CA" ? "fr" : "en");

const en = {
  careersAt: (brand: string) => `Careers at ${brand}`,
  openRoles: (n: number) => (n === 1 ? "1 open role" : `${n} open roles`),
  noRoles: "There are no open roles right now. Check back soon.",
  allDepartments: "All teams",
  allLocations: "All locations",
  search: "Search roles",
  filter: "Filter",
  salary: "Salary range:",
  team: "Team",
  location: "Location",
  perYear: "per year",
  posted: "Posted",
  apply: "Apply for this role",
  backToJobs: "All open roles",
  language: "Français",
  workplace: { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" },
  employment: { full_time: "Full-time", part_time: "Part-time", contract: "Contract", intern: "Internship" },
  partOf: "Part of Purpose Unlimited",
  notFound: "This role is no longer open.",
  privacy: "We use your information only to consider you for roles, as described in our privacy notice.",
};

const fr: typeof en = {
  careersAt: (brand: string) => `Carrières chez ${brand}`,
  openRoles: (n: number) => (n === 1 ? "1 poste ouvert" : `${n} postes ouverts`),
  noRoles: "Aucun poste n'est ouvert pour le moment. Revenez bientôt.",
  allDepartments: "Toutes les équipes",
  allLocations: "Tous les lieux",
  search: "Rechercher un poste",
  filter: "Filtrer",
  salary: "Échelle salariale :",
  team: "Équipe",
  location: "Lieu",
  perYear: "par année",
  posted: "Publié le",
  apply: "Postuler",
  backToJobs: "Tous les postes ouverts",
  language: "English",
  workplace: { onsite: "Sur place", hybrid: "Hybride", remote: "À distance" },
  employment: { full_time: "Temps plein", part_time: "Temps partiel", contract: "Contrat", intern: "Stage" },
  partOf: "Membre de Purpose Unlimited",
  notFound: "Ce poste n'est plus ouvert.",
  privacy: "Nous utilisons vos renseignements uniquement pour évaluer votre candidature, comme le décrit notre avis de confidentialité.",
};

export function t(locale: CareerLocale) {
  return locale === "fr-CA" ? fr : en;
}

export function formatPay(min: number | null, max: number | null, currency: string, locale: CareerLocale) {
  const f = new Intl.NumberFormat(locale === "fr-CA" ? "fr-CA" : "en-CA", { style: "currency", currency, maximumFractionDigits: 0 });
  if (min != null && max != null) return `${f.format(min)} – ${f.format(max)}`;
  if (min != null || max != null) return f.format((min ?? max)!);
  return null;
}
