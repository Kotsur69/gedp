import { EmptyTab, screenMetadata } from "@/components/shell/empty-tab";

export function generateMetadata() {
  return screenMetadata("myInformation");
}

// HOME-17: the tab exists, its content is still to be agreed with HR (Q-15).
export default function MyInformationPage() {
  return <EmptyTab tab="myInformation" reason="emptyTab" />;
}
