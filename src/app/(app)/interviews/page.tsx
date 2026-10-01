import { ComingSoon } from "@/components/coming-soon";

export const metadata = { title: "Interviews" };

export default function Page() {
  return <ComingSoon title="Interviews" phase="Phase 2" features={["Scheduling with Outlook free/busy", "Candidate self-scheduling links", "Teams meeting links on every interview"]} />;
}
