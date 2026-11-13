import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { requireEmployee } from "@/server/current-employee";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitch } from "@/components/language-switch";
import { SignOutForm } from "@/components/sign-out-form";

// The cycle year selector (HOME-16) comes with the app shell; until then the open cycle is fixed.
const CURRENT_CYCLE_YEAR = 2027;

// Temporary home until the dashboard lands; proves the access gate end to end.
export default async function Home() {
  const t = await getTranslations("common");
  return (
    <>
      <header className="border-b border-line bg-white/55 shadow-panel backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-6xl items-center justify-between gap-3 px-4 sm:gap-4 sm:px-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <BrandLogo priority className="h-8 w-auto sm:h-11" />
            <span className="hidden h-7 w-px bg-line-strong sm:block" aria-hidden="true" />
            <span className="whitespace-nowrap font-semibold text-ink">{t("appName")}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <LanguageSwitch />
            <Suspense fallback={null}>
              <UserMenu />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-14">
        <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
          <Greeting />
        </Suspense>
      </main>
    </>
  );
}

async function UserMenu() {
  const employee = await requireEmployee();
  return (
    <div className="flex items-center gap-4">
      <span className="hidden text-sm text-ink sm:inline">
        {employee.firstName} {employee.lastName}
      </span>
      {employee.isHrAdmin && (
        <span className="rounded-full bg-(image:--am-gradient) px-2.5 py-0.5 text-xs font-semibold tracking-[0.06em] text-white">
          HR
        </span>
      )}
      <SignOutForm />
    </div>
  );
}

async function Greeting() {
  const [employee, t] = await Promise.all([requireEmployee(), getTranslations()]);
  return (
    <section
      aria-labelledby="greeting"
      className="rounded-3xl border border-white/90 bg-white/75 p-8 shadow-card backdrop-blur-xl sm:p-10"
    >
      <p className="text-xs font-semibold tracking-wider text-accent uppercase">
        {t("glossary.cycleYear", { year: CURRENT_CYCLE_YEAR })}
      </p>
      <h1 id="greeting" className="mt-3 text-3xl font-semibold text-ink sm:text-4xl">
        {t("home.greeting", { year: CURRENT_CYCLE_YEAR, firstName: employee.firstName })}
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-soft">{t("home.placeholder")}</p>
    </section>
  );
}
