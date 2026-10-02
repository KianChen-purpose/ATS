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
  form: {
    title: (job: string) => `Apply: ${job}`,
    required: "required",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone",
    location: "City, province",
    linkedin: "LinkedIn profile URL",
    resume: "Resume (PDF or Word, up to 5 MB)",
    questions: "A few questions",
    yes: "Yes",
    no: "No",
    choose: "Choose…",
    consentProcessing: (brand: string) =>
      `I agree that ${brand}, part of Purpose Unlimited, may collect and use my information to consider me for this role, and keep it in Canada for as long as its privacy notice describes.`,
    consentTalentPool: "Also keep me in mind for future roles (for up to two years). You can withdraw this at any time.",
    submit: "Submit application",
    submitting: "Submitting…",
    doneTitle: "Thank you for applying",
    doneBody: (job: string, brand: string) => `We've received your application for ${job}. ${brand}'s team will review it and be in touch if there's a match. A confirmation is on its way to your inbox.`,
    errors: {
      rate_limited: "Too many attempts. Please wait a few minutes and try again.",
      consent_required: "Please agree to how we'll use your information so we can consider your application.",
      invalid: "Please check the highlighted field.",
      resume: "Please upload your resume as a PDF or Word (.docx) file under 5 MB.",
      answers: "Please answer the required question.",
      job_closed: "This role is no longer accepting applications.",
    },
  },
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
  form: {
    title: (job: string) => `Postuler : ${job}`,
    required: "obligatoire",
    firstName: "Prénom",
    lastName: "Nom",
    email: "Courriel",
    phone: "Téléphone",
    location: "Ville, province",
    linkedin: "URL de votre profil LinkedIn",
    resume: "CV (PDF ou Word, 5 Mo maximum)",
    questions: "Quelques questions",
    yes: "Oui",
    no: "Non",
    choose: "Choisir…",
    consentProcessing: (brand: string) =>
      `J'accepte que ${brand}, membre de Purpose Unlimited, recueille et utilise mes renseignements pour évaluer ma candidature à ce poste, et les conserve au Canada pendant la durée prévue par son avis de confidentialité.`,
    consentTalentPool: "Pensez aussi à moi pour de futurs postes (pendant deux ans au maximum). Je peux retirer ce consentement en tout temps.",
    submit: "Envoyer ma candidature",
    submitting: "Envoi en cours…",
    doneTitle: "Merci d'avoir postulé",
    doneBody: (job: string, brand: string) => `Nous avons bien reçu votre candidature au poste de ${job}. L'équipe de ${brand} l'examinera et communiquera avec vous si votre profil correspond. Une confirmation vous a été envoyée par courriel.`,
    errors: {
      rate_limited: "Trop de tentatives. Veuillez patienter quelques minutes, puis réessayer.",
      consent_required: "Veuillez accepter l'utilisation de vos renseignements afin que nous puissions évaluer votre candidature.",
      invalid: "Veuillez vérifier le champ indiqué.",
      resume: "Veuillez téléverser votre CV en format PDF ou Word (.docx) de moins de 5 Mo.",
      answers: "Veuillez répondre à la question obligatoire.",
      job_closed: "Ce poste n'accepte plus de candidatures.",
    },
  },
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
