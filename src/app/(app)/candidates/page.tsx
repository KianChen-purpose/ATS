import { ComingSoon } from "@/components/coming-soon";

export const metadata = { title: "Candidates" };

export default function Page() {
  return <ComingSoon title="Candidates" phase="Phase 1" features={["All candidates table with search and filters", "Candidate profile with activity timeline", "Notes, tags, stage moves and archive"]} />;
}
