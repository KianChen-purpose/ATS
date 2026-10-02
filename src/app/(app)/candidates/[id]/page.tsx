import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { requireActor } from "@/lib/session";
import { getCandidateProfile, getProfileOptions, viewCandidateProfile } from "@/server/services/candidates";
import { CandidateProfileView } from "@/components/candidates/candidate-profile";

export async function generateMetadata(props: PageProps<"/candidates/[id]">) {
  const { id } = await props.params;
  const user = await requireActor();
  const p = await getCandidateProfile(user, id);
  return { title: p ? `${p.firstName} ${p.lastName}` : "Candidate" };
}

export default async function CandidatePage(props: PageProps<"/candidates/[id]">) {
  const user = await requireActor();
  const { id } = await props.params;
  const sp = await props.searchParams;
  const [profile, options] = await Promise.all([viewCandidateProfile(user, id, "profile"), getProfileOptions(user)]);
  if (!profile) notFound();
  const selectedAppId = typeof sp.app === "string" ? sp.app : undefined;

  return (
    <div className="mx-auto max-w-4xl px-6 py-4">
      <Link href="/candidates" className="mb-3 inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-800">
        <ChevronLeft size={14} /> All candidates
      </Link>
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <CandidateProfileView
          profile={profile}
          options={options}
          user={user}
          selectedAppId={selectedAppId}
          appHref={(appId) => `/candidates/${id}?app=${appId}`}
        />
      </div>
    </div>
  );
}
