import { ComingSoon } from "@/components/coming-soon";

export const metadata = { title: "Jobs" };

export default function Page() {
  return <ComingSoon title="Jobs" phase="Phase 1" features={["Job list with filters by brand, department and status", "Pipeline board and table per job", "Openings and hiring team"]} />;
}
