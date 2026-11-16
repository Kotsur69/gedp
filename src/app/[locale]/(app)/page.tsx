import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { screenMetadata } from "@/components/shell/empty-tab";
import { requireEmployee } from "@/server/current-employee";
import { getSelectedCycle } from "@/server/cycles";

export function generateMetadata() {
  return screenMetadata("gedpCycle");
}

// "Cykl GEDP" tab (start page). Temporary content until the dashboard lands (HOME-10..15).
export default async function Home() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <Greeting />
    </Suspense>
  );
}

async function Greeting() {
  const [employee, cycle, t] = await Promise.all([requireEmployee(), getSelectedCycle(), getTranslations()]);
  return (
    <section
      aria-labelledby="greeting"
      className="rounded-3xl border border-surface/90 bg-surface/75 p-8 shadow-card backdrop-blur-xl sm:p-10"
    >
      {cycle && (
        <p className="text-xs font-semibold tracking-wider text-accent uppercase">
          {t("glossary.cycleYear", { year: cycle.year })}
        </p>
      )}
      <h1 id="greeting" className="mt-3 text-3xl font-semibold text-balance text-ink sm:text-4xl">
        {cycle
          ? t("home.greeting", { year: cycle.year, firstName: employee.firstName })
          : t("home.greetingShort", { firstName: employee.firstName })}
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-soft">{t("home.placeholder")}</p>
    </section>
  );
}
