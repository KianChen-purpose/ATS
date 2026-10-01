import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { getSchedulingLinkSlots } from "@/server/actions/scheduling";
import { SelfSchedule } from "@/components/scheduling/self-schedule";

export const metadata = { title: "Schedule your interview", robots: { index: false } };

export default async function SelfSchedulePage(props: PageProps<"/schedule/[token]">) {
  const { token } = await props.params;
  const link = await db.query.schedulingLinks.findFirst({
    where: eq(s.schedulingLinks.token, token),
    with: { stage: true, application: { with: { candidate: true, job: { with: { brand: true } } } } },
  });

  const shell = (children: React.ReactNode, brand?: { name: string; primaryColor: string }) => (
    <div className="min-h-full bg-zinc-50 px-4 py-10">
      <div className="mx-auto max-w-2xl">
        {brand && (
          <div className="mb-4 flex items-center gap-2">
            <span className="h-6 w-6 rounded" style={{ background: brand.primaryColor }} />
            <span className="text-base font-semibold">{brand.name}</span>
          </div>
        )}
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
      </div>
    </div>
  );

  if (!link) return shell(<p className="text-center text-zinc-600">This scheduling link isn&apos;t valid.</p>);
  const { job, candidate } = link.application;
  if (link.bookedInterviewId) return shell(<p className="text-center text-zinc-600">This interview has already been scheduled. Check your email for the details.</p>, job.brand);
  if (link.windowEnd < new Date()) return shell(<p className="text-center text-zinc-600">This link has expired. Please reply to your recruiter for a new one.</p>, job.brand);

  const slots = (await getSchedulingLinkSlots(token)) ?? [];
  return shell(
    <>
      <h1 className="text-lg font-semibold">Hi {candidate.firstName}, pick a time for your {link.stage?.name ?? "interview"}</h1>
      <p className="mt-1 mb-5 text-zinc-600">
        {job.title} · {job.brand.name} · Microsoft Teams
      </p>
      <SelfSchedule token={token} slots={slots} durationMin={link.durationMinutes} brandColor={job.brand.primaryColor} />
    </>,
    job.brand,
  );
}
