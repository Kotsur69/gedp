import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getAccess } from "@/server/current-employee";
import type { NoAccessReason } from "@/server/access";
import { BrandCard } from "@/components/brand-card";
import { SignOutForm } from "@/components/sign-out-form";

// TODO(glossary): Polish labels are hard-coded until the glossary / next-intl lands.
const REASON_MESSAGES: Record<NoAccessReason, string> = {
  UNKNOWN: "Twojego konta nie ma w bazie pracowników objętych procesem GEDP.",
  INACTIVE: "Twoje konto pracownika jest nieaktywne.",
  NOT_WHITE_COLLAR: "Proces GEDP obejmuje tylko pracowników White Collar.",
};

export default function NoAccessPage() {
  return (
    <BrandCard title="Brak dostępu" subtitle="GEDP 2027 · Global Employee Development Program">
      <Suspense fallback={<p className="text-sm text-ink-soft">Sprawdzanie dostępu…</p>}>
        <NoAccessReasonSection />
      </Suspense>
    </BrandCard>
  );
}

async function NoAccessReasonSection() {
  const access = await getAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "ok") redirect("/");

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-accent/7 px-4 py-3">
        <p className="leading-relaxed text-ink">{REASON_MESSAGES[access.reason]}</p>
        <p className="mt-1 text-sm text-ink-soft">Jeśli to pomyłka, skontaktuj się z działem HR.</p>
      </div>
      <SignOutForm variant="secondary" />
    </div>
  );
}
