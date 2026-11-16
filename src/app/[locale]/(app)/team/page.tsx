import { Suspense } from "react";
import { EmptyTab, screenMetadata } from "@/components/shell/empty-tab";
import { requireTab } from "@/server/navigation";

export function generateMetadata() {
  return screenMetadata("myTeam");
}

// "Mój zespół" (HOME-12): managers and override validators only; anyone else gets 404.
// Placeholder until the team view is built.
export default function TeamPage() {
  return (
    <Suspense fallback={null}>
      <GuardedTeam />
    </Suspense>
  );
}

async function GuardedTeam() {
  await requireTab("myTeam");
  return <EmptyTab tab="myTeam" reason="comingSoon" />;
}
