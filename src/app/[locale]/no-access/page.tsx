import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getAccess } from "@/server/current-employee";
import { BrandCard } from "@/components/brand-card";
import { SignOutForm } from "@/components/sign-out-form";

export default async function NoAccessPage() {
  const t = await getTranslations();
  return (
    <BrandCard title={t("noAccess.title")} subtitle={`${t("common.appName")} · ${t("common.programName")}`}>
      <Suspense fallback={<p className="text-sm text-ink-soft">{t("noAccess.checking")}</p>}>
        <NoAccessReasonSection />
      </Suspense>
    </BrandCard>
  );
}

async function NoAccessReasonSection() {
  const access = await getAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "ok") redirect("/");
  const t = await getTranslations("noAccess");

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-accent/7 px-4 py-3">
        <p className="leading-relaxed text-ink">{t(`reasons.${access.reason}`)}</p>
        <p className="mt-1 text-sm text-ink-soft">{t("contactHr")}</p>
      </div>
      <SignOutForm variant="secondary" />
    </div>
  );
}
