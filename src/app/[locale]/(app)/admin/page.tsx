import { Suspense } from "react";
import { EmptyTab, screenMetadata } from "@/components/shell/empty-tab";
import { requireTab } from "@/server/navigation";

export function generateMetadata() {
  return screenMetadata("administrator");
}

// "Administrator" (HOME-12): HR only; anyone else gets 404. Placeholder until the HR panel is built.
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <GuardedAdmin />
    </Suspense>
  );
}

async function GuardedAdmin() {
  await requireTab("administrator");
  return <EmptyTab tab="administrator" reason="comingSoon" />;
}
