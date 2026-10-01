import type { schema } from "@/db";

/** Default interview plan for new jobs. */
export const DEFAULT_STAGES: { name: string; type: (typeof schema.stageType.enumValues)[number] }[] = [
  { name: "Lead", type: "lead" },
  { name: "Application Review", type: "review" },
  { name: "Recruiter Screen", type: "screen" },
  { name: "Hiring Manager Interview", type: "interview" },
  { name: "Skills Interview", type: "interview" },
  { name: "Final Interviews", type: "interview" },
  { name: "Offer", type: "offer" },
  { name: "Hired", type: "hired" },
];

