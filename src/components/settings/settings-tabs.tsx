import { FilterTabs } from "@/components/ui/filter-tabs";

const TABS = [
  { key: "approvals", label: "Approvals" },
  { key: "integrations", label: "Integrations" },
];

export function SettingsTabs({ active }: { active: "approvals" | "integrations" }) {
  return <FilterTabs tabs={TABS} active={active} hrefFor={(k) => `/settings/${k}`} />;
}
