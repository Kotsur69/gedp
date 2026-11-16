import { EmptyTab, screenMetadata } from "@/components/shell/empty-tab";

export function generateMetadata() {
  return screenMetadata("helpAndSupport");
}

// HOME-18: the tab exists, its content is still to be agreed with HR (Q-15).
export default function HelpPage() {
  return <EmptyTab tab="helpAndSupport" reason="emptyTab" />;
}
