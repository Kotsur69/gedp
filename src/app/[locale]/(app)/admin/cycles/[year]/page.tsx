import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon, InfoIcon } from "@/components/shell/icons";
import { GROUP_GOAL_TYPES } from "@/domain/cycle-config";
import { requireEmployee } from "@/server/current-employee";
import { loadCycleConfig } from "@/server/cycle-admin";
import { parseCycleYear } from "@/server/cycles";
import { db } from "@/server/db";
import { CatalogList } from "./catalog-list";
import { CycleSettingsForm } from "./cycle-settings-form";
import { CycleStatusControl } from "./cycle-status-control";
import { GroupGoalEditor } from "./group-goal-editor";
import { TargetTypeList } from "./target-type-list";

// HR panel, one cycle's configuration (HR-05): status, year and dates, closing thresholds, Group
// goal texts, competencies, development areas and target types. HR only (403 boundary); a year
// that is not a cycle is a 404. A closed cycle renders read-only; every Server Action checks again.

type CyclePageProps = { params: Promise<{ year: string }> };

export async function generateMetadata({ params }: CyclePageProps): Promise<Metadata> {
  const [{ year }, t] = await Promise.all([params, getTranslations()]);
  const screen = t("admin.cycles.detail.title", { year: parseCycleYear(year) ?? year });
  return { title: t("header.screen", { app: t("common.appName"), screen }) };
}

export default async function CyclePage({ params }: CyclePageProps) {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedCycle params={params} />
    </Suspense>
  );
}

const SECTIONS = ["status", "settings", "groupGoals", "competencies", "developmentAreas", "targetTypes"] as const;
type SectionKey = (typeof SECTIONS)[number];
const sectionId = (key: SectionKey) => `cycle-section-${key}`;

async function GuardedCycle({ params }: CyclePageProps) {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();
  const year = parseCycleYear((await params).year);
  if (year === null) notFound();

  const [config, t] = await Promise.all([loadCycleConfig(db(), viewer, year), getTranslations("admin.cycles")]);
  if (!config) notFound();

  // The client parts get only the messages they render (DatePicker uses goalControls).
  const { admin, glossary, goalControls } = await getMessages();
  const clientMessages = {
    admin: { cycles: admin.cycles },
    glossary: { cycleStatus: glossary.cycleStatus, groupGoalTypes: glossary.groupGoalTypes },
    goalControls,
  };
  const sectionTitle = (key: SectionKey) => t(`${key}.title`);
  const templates = new Map(config.groupGoals.map((goal) => [goal.type, goal]));
  const pageTitle = t("detail.title", { year: config.year });

  return (
    <section
      aria-labelledby="screen-title"
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <Link
        href="/admin/cycles"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronLeftIcon className="size-4" />
        {t("detail.back")}
      </Link>
      <h1 id="screen-title" className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">
        {pageTitle}
      </h1>
      <p className="mt-2 text-sm text-ink-soft">{t("detail.auditNote")}</p>

      <nav aria-label={pageTitle} className="mt-5">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((key) => (
            <li key={key}>
              <a
                href={`#${sectionId(key)}`}
                className="inline-flex min-h-11 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
              >
                {sectionTitle(key)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {!config.isEditable && (
        <p className="mt-6 flex items-start gap-2 rounded-2xl border border-line-strong bg-canvas px-4 py-3 text-ink">
          <InfoIcon className="mt-0.5 size-5 shrink-0 text-accent" />
          {t("detail.closedNotice")}
        </p>
      )}

      <NextIntlClientProvider messages={clientMessages}>
        <div className="mt-8 grid gap-10">
          <ConfigSection id={sectionId("status")} title={sectionTitle("status")}>
            <CycleStatusControl
              cycleId={config.id}
              year={config.year}
              status={config.status}
              documentCount={config.documentCount}
              otherOpenYear={config.otherOpenYear}
              gaps={config.gaps}
            />
          </ConfigSection>

          <ConfigSection id={sectionId("settings")} title={sectionTitle("settings")} intro={t("settings.intro")}>
            <CycleSettingsForm
              key={config.year}
              cycleId={config.id}
              initial={{
                year: config.year,
                goalSettingOpensAt: config.goalSettingOpensAt,
                goalSettingClosesAt: config.goalSettingClosesAt,
                minPerformanceGoals: config.minPerformanceGoals,
                requiredWeightSum: config.requiredWeightSum,
                minDevelopmentGoals: config.minDevelopmentGoals,
              }}
              isEditable={config.isEditable}
              canChangeYear={config.canChangeYear}
            />
          </ConfigSection>

          <ConfigSection id={sectionId("groupGoals")} title={sectionTitle("groupGoals")} intro={t("groupGoals.intro")}>
            <div className="grid gap-4">
              {GROUP_GOAL_TYPES.map((type) => {
                const template = templates.get(type);
                return (
                  <GroupGoalEditor
                    key={type}
                    cycleId={config.id}
                    type={type}
                    contentPl={template?.contentPl ?? ""}
                    contentEn={template?.contentEn ?? ""}
                    acknowledgements={template ? template.acknowledgements : null}
                    isEditable={config.isEditable}
                  />
                );
              })}
            </div>
          </ConfigSection>

          <ConfigSection id={sectionId("competencies")} title={sectionTitle("competencies")} intro={t("competencies.intro")}>
            <CatalogList cycleId={config.id} kind="competency" items={config.competencies} isEditable={config.isEditable} />
          </ConfigSection>

          <ConfigSection
            id={sectionId("developmentAreas")}
            title={sectionTitle("developmentAreas")}
            intro={t("developmentAreas.intro")}
          >
            <CatalogList
              cycleId={config.id}
              kind="developmentArea"
              items={config.developmentAreas}
              isEditable={config.isEditable}
            />
          </ConfigSection>

          <ConfigSection id={sectionId("targetTypes")} title={sectionTitle("targetTypes")} intro={t("targetTypes.intro")}>
            <TargetTypeList cycleId={config.id} items={config.targetTypes} isEditable={config.isEditable} />
          </ConfigSection>
        </div>
      </NextIntlClientProvider>
    </section>
  );
}

type ConfigSectionProps = { id: string; title: string; intro?: string; children: ReactNode };

function ConfigSection({ id, title, intro, children }: ConfigSectionProps) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <h2 id={`${id}-title`} className="text-xl font-semibold text-ink">
        {title}
      </h2>
      {intro && <p className="mt-1 max-w-prose text-ink-soft">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
