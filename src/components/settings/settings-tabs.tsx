import { FilterTabs } from "@/components/ui/filter-tabs";

const TABS = [
  { key: "approvals", label: "Approvals" },
  { key: "offer-letters", label: "Offer letters" },
  { key: "integrations", label: "Integrations" },
];

export function SettingsTabs({ active }: { active: "approvals" | "offer-letters" | "integrations" }) {
  return <FilterTabs tabs={TABS} active={active} hrefFor={(k) => `/settings/${k}`} />;
}
