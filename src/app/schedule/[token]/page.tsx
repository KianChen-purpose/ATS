import { getPublicSchedulingPage } from "@/server/services/scheduling-links";
import { SelfSchedule } from "@/components/scheduling/self-schedule";

export const metadata = { title: "Schedule your interview", robots: { index: false } };

export default async function SelfSchedulePage(props: PageProps<"/schedule/[token]">) {
  const { token } = await props.params;
  const page = await getPublicSchedulingPage(token);

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

  if (page.state === "invalid") return shell(<p className="text-center text-zinc-600">This scheduling link isn&apos;t valid.</p>);
  if (page.state === "booked") return shell(<p className="text-center text-zinc-600">This interview has already been scheduled. Check your email for the details.</p>, page.brand);
  if (page.state === "expired") return shell(<p className="text-center text-zinc-600">This link has expired. Please reply to your recruiter for a new one.</p>, page.brand);

  return shell(
    <>
      <h1 className="text-lg font-semibold">Hi {page.candidateFirstName}, pick a time for your {page.stageName ?? "interview"}</h1>
      <p className="mt-1 mb-5 text-zinc-600">
        {page.jobTitle} · {page.brand.name} · Microsoft Teams
      </p>
      <SelfSchedule token={token} slots={page.slots} durationMin={page.durationMin} brandColor={page.brand.primaryColor} />
    </>,
    page.brand,
  );
}
