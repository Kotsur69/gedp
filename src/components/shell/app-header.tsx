import { Suspense } from "react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitch } from "@/components/language-switch";
import { SignOutForm } from "@/components/sign-out-form";
import { MainTabs, ScreenTitle, type ShellTab } from "@/components/shell/active-screen";
import { CycleYearSelect } from "@/components/shell/cycle-year-select";
import { ExternalLinkIcon, EyeIcon } from "@/components/shell/icons";
import { orderedTabs, TAB_IDS, type TabId } from "@/components/shell/tabs";
import { requireEmployee } from "@/server/current-employee";
import { getCycleChoice } from "@/server/cycles";
import { readHeaderLinks } from "@/server/header-links";
import { getVisibleTabs } from "@/server/navigation";

// App header (HOME-16): logo, "app – screen", cycle year, HR links, language, account, main tabs.
// The frame, logo, title and language switch are static (prerendered per language); everything
// that depends on the person or on runtime config streams in through its own Suspense slot.
// Hamburger and info-icon menus are left out until their content is known (Q-15).
//
// One flex-wrap row, re-ordered per breakpoint, then the tab row:
//   phone:  logo ........ language account  |  title  |  year view-only ... links  |  tabs (scroll)
//   sm:     logo | title ...... language account  |  year view-only ......... links  |  tabs
//   lg:     logo | title  year view-only ......... language account  |  tabs ......... links
// The links render in both places; CSS shows exactly one (display:none keeps the other out of
// the accessibility tree).

export async function AppHeader() {
  const t = await getTranslations();
  const appName = t("common.appName");
  const titles = Object.fromEntries(
    TAB_IDS.map((id) => [id, t("header.screen", { app: appName, screen: t(`nav.${id}`) })]),
  ) as Record<TabId, string>;

  return (
    <header className="relative z-20">
      <div aria-hidden="true" className="h-1 bg-(image:--am-gradient)" />
      <div className="border-b border-line bg-surface/70 shadow-panel backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="order-1 flex shrink-0 items-center gap-4">
              <BrandLogo priority className="h-8 w-auto sm:h-10" />
              <span className="hidden h-7 w-px bg-line-strong sm:block" aria-hidden="true" />
            </div>
            <div className="order-3 min-w-0 basis-full sm:order-2 sm:flex-1 sm:basis-auto lg:flex-none">
              <ScreenTitle titles={titles} fallback={appName} />
            </div>
            <div className="order-2 ml-auto flex items-center gap-2 sm:order-3 lg:order-4">
              <LanguageSwitch />
              <Suspense fallback={null}>
                <AccountSlot />
              </Suspense>
            </div>
            <Suspense fallback={<div className="order-4 min-h-11 w-28 lg:order-3" aria-hidden="true" />}>
              <CycleSlot />
            </Suspense>
            <Suspense fallback={null}>
              <LinksSlot className="order-5 ml-auto lg:hidden" />
            </Suspense>
          </div>
          <div className="flex items-center gap-6 border-t border-line">
            <div className="min-w-0 flex-1">
              <Suspense fallback={<div className="min-h-12" aria-hidden="true" />}>
                <TabsSlot />
              </Suspense>
            </div>
            <Suspense fallback={null}>
              <LinksSlot className="hidden shrink-0 lg:flex" />
            </Suspense>
          </div>
        </div>
      </div>
    </header>
  );
}

async function AccountSlot() {
  const [employee, t] = await Promise.all([requireEmployee(), getTranslations("auth.flags")]);
  return (
    <div className="flex items-center gap-3">
      <span className="hidden text-sm text-ink xl:inline">
        {employee.firstName} {employee.lastName}
      </span>
      {employee.isHrAdmin && (
        <span className="rounded-full bg-(image:--am-gradient) px-2.5 py-0.5 text-xs font-semibold tracking-[0.06em] text-on-brand">
          {t("hr")}
        </span>
      )}
      <SignOutForm />
    </div>
  );
}

/** Year selector (NFR-05) plus a view-only notice when the selected cycle is not open. */
async function CycleSlot() {
  const [{ options, selected }, t] = await Promise.all([getCycleChoice(), getTranslations()]);
  if (!selected) return null;
  const items = options.map((option) => ({
    year: option.year,
    label:
      option.status === "OTWARTY"
        ? String(option.year)
        : t("header.cycleOption", { year: option.year, status: t(`glossary.cycleStatus.${option.status}`) }),
  }));
  return (
    <div className="order-4 flex flex-wrap items-center gap-x-3 gap-y-2 lg:order-3">
      <CycleYearSelect
        options={items}
        selectedYear={selected.year}
        label={t("header.cycleYear")}
        errorMessage={t("header.yearChangeFailed")}
      />
      {selected.status !== "OTWARTY" && (
        <p className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-notice-surface px-3 text-xs font-semibold text-notice">
          <EyeIcon className="size-3.5 shrink-0" />
          {/* lg+: the select already names the status, so the notice stays short to keep one row. */}
          <span className="lg:hidden">{t(`header.viewOnly.${selected.status}`)}</span>
          <span className="hidden lg:inline" title={t(`header.viewOnly.${selected.status}`)}>
            {t("header.viewOnlyShort")}
          </span>
        </p>
      )}
    </div>
  );
}

/** "Lista kontaktów HR" / "GEDP Toolkit" (Q-08): runtime config, each hidden while unset. */
async function LinksSlot({ className }: { className: string }) {
  // Read the environment per request, not at build time: changing a URL needs a restart only.
  await connection();
  const links = readHeaderLinks(process.env);
  const t = await getTranslations("header");
  const items = [
    { href: links.hrContacts, label: t("hrContacts") },
    { href: links.toolkit, label: t("toolkit") },
  ].filter((item): item is { href: string; label: string } => item.href !== null);
  if (items.length === 0) return null;
  return (
    <ul className={`flex flex-wrap items-center gap-x-4 ${className}`}>
      {items.map((item) => (
        <li key={item.label}>
          <a
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-ink-soft underline-offset-4 transition-colors duration-200 hover:text-accent hover:underline motion-reduce:transition-none"
          >
            {item.label}
            <ExternalLinkIcon className="size-3.5 shrink-0" />
            <span className="sr-only">{t("opensInNewTab")}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Main tabs, filtered by role on the server (HOME-12). */
async function TabsSlot() {
  const [visible, t] = await Promise.all([getVisibleTabs(), getTranslations("nav")]);
  const tabs: ShellTab[] = orderedTabs(visible).map((tab) => ({ id: tab.id, href: tab.href, label: t(tab.id) }));
  return <MainTabs tabs={tabs} label={t("mainMenu")} />;
}
