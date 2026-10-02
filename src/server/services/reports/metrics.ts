/**
 * The metrics layer (PRD §7.4): one written definition per number PATS reports, so "time to hire"
 * means the same thing on every report, export and dashboard. The SQL in standard.ts and the builder
 * implements exactly these definitions; the UI shows them in "How is this measured?".
 */
export type MetricKey =
  | "applications"
  | "hires"
  | "offer_acceptance_rate"
  | "time_to_hire"
  | "time_to_first_touch"
  | "time_in_stage"
  | "time_to_fill"
  | "stage_conversion"
  | "hire_rate"
  | "open_openings"
  | "job_age"
  | "feedback_timeliness"
  | "positive_rate";

export const METRICS: Record<MetricKey, { label: string; definition: string }> = {
  applications: {
    label: "Applications",
    definition: "Applications created in the date range (career site, referral, or added by the team), on jobs you can see.",
  },
  hires: {
    label: "Hires",
    definition: "Applications marked hired in the date range.",
  },
  offer_acceptance_rate: {
    label: "Offer acceptance",
    definition: "Offers accepted ÷ offers accepted or declined, for offers decided in the date range. Withdrawn offers are excluded.",
  },
  time_to_hire: {
    label: "Time to hire",
    definition: "Median calendar days from application to hire, for hires in the date range.",
  },
  time_to_first_touch: {
    label: "Time to first touch",
    definition: "Median days from application to the first stage move or archive by a team member, for applications in the date range. Automatic archives (knockout questions) don't count.",
  },
  time_in_stage: {
    label: "Time in stage",
    definition: "Median days an application spent in a stage type before moving on, for stage exits in the date range. Read from the immutable stage history.",
  },
  time_to_fill: {
    label: "Time to fill",
    definition: "Median days from an opening being created to it being filled, for openings filled in the date range.",
  },
  stage_conversion: {
    label: "Conversion",
    definition: "Of applications in the date range that reached a stage type (or any later one), the share that reached the next stage type.",
  },
  hire_rate: {
    label: "Hire rate",
    definition: "Hires ÷ applications, for applications created in the date range.",
  },
  open_openings: {
    label: "Open openings",
    definition: "Openings (headcount) currently open on jobs you can see. Not affected by the date range.",
  },
  job_age: {
    label: "Days open",
    definition: "Calendar days since the job was opened. Jobs that were never opened count from creation.",
  },
  feedback_timeliness: {
    label: "Feedback within 24h",
    definition: "Share of scorecards submitted within 24 hours of the interview ending, for interviews that ended in the date range.",
  },
  positive_rate: {
    label: "Yes rate",
    definition: "Share of an interviewer's scorecards recommending Yes or Strong Yes. Shown only once they have 5 or more scorecards in the range.",
  },
};

/** Stage types in pipeline order. A later type implies the earlier ones were passed (or skipped). */
export const STAGE_ORDER = ["lead", "review", "screen", "interview", "offer", "hired"] as const;
export type StageTypeKey = (typeof STAGE_ORDER)[number];

export const STAGE_TYPE_LABELS: Record<StageTypeKey, string> = {
  lead: "Lead",
  review: "Application review",
  screen: "Screen",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
};

/** Calibration figures need a minimum sample before they're shown. */
export const MIN_SAMPLE = 5;
