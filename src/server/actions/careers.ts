"use server";

import { careerLocale } from "@/lib/i18n/careers";
import { PUBLIC_LIMITS, RateLimitError, rateLimit } from "@/server/security/rate-limit";
import { clientIp } from "@/server/security/request";
import { applySchema, submitApplication } from "@/server/services/career-applications";

export type ApplyState = { status: "idle" } | { status: "done" } | { status: "error"; error: string; field?: string };

/** Minimum time a person takes to fill the form; faster submissions are treated as bots. */
const MIN_FILL_MS = 3000;

/** Public: career-site application. A server action is a public endpoint; it trusts nothing. */
export async function applyToJob(_prev: ApplyState, form: FormData): Promise<ApplyState> {
  try {
    rateLimit(`apply:${await clientIp()}`, PUBLIC_LIMITS.apply);
  } catch (e) {
    if (e instanceof RateLimitError) return { status: "error", error: "rate_limited" };
    throw e;
  }
  // Bots: a filled honeypot or an instant submit gets a normal-looking success and is dropped.
  const started = Number(form.get("started"));
  if (form.get("website") || !Number.isFinite(started) || Date.now() - started < MIN_FILL_MS) return { status: "done" };

  const answers: Record<string, string> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("q_") && typeof v === "string" && v.trim()) answers[k.slice(2)] = v;
  const parsed = applySchema.safeParse({
    jobId: form.get("jobId"),
    locale: careerLocale(String(form.get("lang") ?? "")),
    firstName: form.get("firstName"),
    lastName: form.get("lastName"),
    email: form.get("email"),
    phone: form.get("phone") ?? undefined,
    location: form.get("location") ?? undefined,
    linkedinUrl: form.get("linkedinUrl") ?? undefined,
    answers,
    consentProcessing: form.get("consentProcessing") === "on",
    consentTalentPool: form.get("consentTalentPool") === "on",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { status: "error", error: issue?.message === "consent_required" ? "consent_required" : "invalid", field: String(issue?.path[0] ?? "") };
  }
  const file = form.get("resume");
  const resume = file instanceof File && file.size > 0 ? { name: file.name, bytes: Buffer.from(await file.arrayBuffer()) } : null;
  const r = await submitApplication(parsed.data, resume);
  return r.ok ? { status: "done" } : { status: "error", error: r.error, field: r.field };
}
