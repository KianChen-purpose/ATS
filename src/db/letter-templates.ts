/**
 * Builds the default Word offer letter templates (EN and FR-CA) used by the seed and tests.
 * Admins replace them with their own .docx files in Settings → Offer letters.
 * Merge fields use docxtemplater syntax: {field}, and {#section}…{/section} for optional parts.
 */
import { AlignmentType, Document, Packer, Paragraph, TextRun } from "docx";

// Brand typefaces (brand/BRAND.md): Season Mix for headings, Inter for body. Text in Black.
const HEADING = { font: "Season Mix", color: "000000" };
const BODY = { font: "Inter", size: 21, color: "000000" };

const p = (text: string, opts: { bold?: boolean; after?: number } = {}) =>
  new Paragraph({ spacing: { after: opts.after ?? 160 }, children: [new TextRun({ ...BODY, text, bold: opts.bold })] });

type Copy = {
  title: string;
  greeting: string;
  intro: string;
  termsHeading: string;
  base: string;
  bonus: string;
  signOn: string;
  equity: string;
  start: string;
  closing: string;
  signoff: string;
  accept: string;
};

const COPY: Record<"en" | "fr-CA", Copy> = {
  en: {
    title: "Offer of employment",
    greeting: "Dear {candidate_first_name},",
    intro: "We're delighted to offer you the position of {job_title} at {brand_name}, on the terms below.",
    termsHeading: "Your offer",
    base: "Base salary: {base_salary} per year",
    bonus: "{#bonus}Target annual bonus: {bonus_percent}% of base salary{/bonus}",
    signOn: "{#sign_on}Sign-on bonus: {sign_on_bonus}{/sign_on}",
    equity: "{#equity_terms}Equity / long-term incentive: {equity}{/equity_terms}",
    start: "{#start}Start date: {start_date}{/start}",
    closing: "This offer is conditional on satisfactory reference and background checks. We look forward to welcoming you to the team.",
    signoff: "Sincerely,",
    accept: "Accepted by: ______________________   Date: ______________",
  },
  "fr-CA": {
    title: "Offre d'emploi",
    greeting: "Bonjour {candidate_first_name},",
    intro: "Nous avons le plaisir de vous offrir le poste de {job_title} chez {brand_name}, selon les conditions ci-dessous.",
    termsHeading: "Votre offre",
    base: "Salaire de base : {base_salary} par année",
    bonus: "{#bonus}Prime annuelle cible : {bonus_percent} % du salaire de base{/bonus}",
    signOn: "{#sign_on}Prime à la signature : {sign_on_bonus}{/sign_on}",
    equity: "{#equity_terms}Participation / incitatif à long terme : {equity}{/equity_terms}",
    start: "{#start}Date d'entrée en fonction : {start_date}{/start}",
    closing: "Cette offre est conditionnelle à la vérification satisfaisante des références et des antécédents. Nous avons hâte de vous accueillir dans l'équipe.",
    signoff: "Veuillez agréer nos salutations distinguées,",
    accept: "Accepté par : ______________________   Date : ______________",
  },
};

export async function buildDefaultLetterTemplate(locale: "en" | "fr-CA") {
  const c = COPY[locale];
  const doc = new Document({
    styles: { default: { document: { run: { font: BODY.font, size: BODY.size, color: BODY.color } } } },
    sections: [
      {
        children: [
          new Paragraph({ children: [new TextRun({ ...HEADING, text: "{brand_name}", size: 28 })], spacing: { after: 80 } }),
          new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ ...BODY, text: "{today}" })], spacing: { after: 320 } }),
          new Paragraph({ children: [new TextRun({ ...HEADING, text: c.title, size: 36 })], spacing: { after: 240 } }),
          p(c.greeting),
          p(c.intro, { after: 240 }),
          new Paragraph({ children: [new TextRun({ ...HEADING, text: c.termsHeading, size: 26 })], spacing: { after: 120 } }),
          p(c.base, { after: 80 }),
          p(c.bonus, { after: 80 }),
          p(c.signOn, { after: 80 }),
          p(c.equity, { after: 80 }),
          p(c.start, { after: 240 }),
          p(c.closing, { after: 320 }),
          p(c.signoff, { after: 80 }),
          p("{sender_name}", { after: 80 }),
          p("{brand_name}", { after: 480 }),
          p(c.accept),
        ],
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
