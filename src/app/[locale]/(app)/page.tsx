import { Suspense, type ReactNode } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { CollapsibleIntro } from "@/components/home/collapsible-intro";
import { HomeTiles } from "@/components/home/home-tiles";
import { IntroMarkdown } from "@/components/home/intro-markdown";
import { StartAnnouncement } from "@/components/home/start-announcement";
import { TaskCarousel, type TaskCardData } from "@/components/home/task-carousel";
import { screenMetadata } from "@/components/shell/empty-tab";
import { InfoIcon } from "@/components/shell/icons";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { requireEmployee } from "@/server/current-employee";
import { loadUnseenStartAnnouncement } from "@/server/content";
import { getSelectedCycle } from "@/server/cycles";
import { db } from "@/server/db";
import { buildHomeTasks, loadOwnDocumentSummary, loadPublishedContent, type HomeTask } from "@/server/home";

export function generateMetadata() {
  return screenMetadata("gedpCycle");
}

// "Cykl GEDP" tab, the start page (HOME-01, 10, 11, 13, 14). Per-person data, so it renders
// dynamically inside Suspense (cacheComponents). Statistics (HOME-15) come with file 07.
export default async function Home() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <Dashboard />
    </Suspense>
  );
}

async function Dashboard() {
  const [employee, cycle, locale, t] = await Promise.all([
    requireEmployee(),
    getSelectedCycle(),
    getLocale(),
    getTranslations(),
  ]);
  const [intro, announcement, document] = await Promise.all([
    loadPublishedContent(db(), "TEKST_POWITALNY", locale),
    loadUnseenStartAnnouncement(db(), employee.id, locale),
    cycle ? loadOwnDocumentSummary(db(), employee.id, cycle.year) : null,
  ]);
  const tasks = await toTaskCards(buildHomeTasks({ cycle, document }), cycle?.year ?? null, locale);

  return (
    <div className="flex flex-col gap-6">
      {announcement && (
        <StartAnnouncement
          key={announcement.version}
          version={announcement.version}
          labels={{
            title: t("home.announcement.title"),
            close: t("common.close"),
            acknowledge: t("home.announcement.acknowledge"),
          }}
        >
          <IntroMarkdown markdown={announcement.markdown} newTabLabel={t("header.opensInNewTab")} headings />
        </StartAnnouncement>
      )}
      <Panel labelledBy="greeting">
        {/* The plain-text aria-label keeps the info button's name out of the heading's name. */}
        <h1
          id="greeting"
          aria-label={
            cycle
              ? t.markup("home.greeting", { year: cycle.year, firstName: employee.firstName, highlight: (chunks) => chunks })
              : undefined
          }
          className="text-3xl font-semibold text-balance text-ink sm:text-4xl"
        >
          {cycle
            ? t.rich("home.greeting", {
                year: cycle.year,
                firstName: employee.firstName,
                highlight: (chunks) => <YearHighlight infoLabel={t("home.yearInfoLabel")}>{chunks}</YearHighlight>,
              })
            : t("home.greetingShort", { firstName: employee.firstName })}
        </h1>
        {cycle && <YearInfoPopover text={t("home.yearInfo")} />}

        {intro && (
          <CollapsibleIntro
            label={t("home.intro.label")}
            expandLabel={t("home.intro.expand")}
            collapseLabel={t("home.intro.collapse")}
          >
            <IntroMarkdown markdown={intro} newTabLabel={t("header.opensInNewTab")} />
          </CollapsibleIntro>
        )}

        {cycle && (
          <HomeTiles
            labelledBy="gedp-cycle-tiles"
            heading={t("nav.gedpCycle")}
            goalCentreLabel={t("home.tiles.goalCentre")}
            documentLabel={t("home.tiles.document")}
            documentStatus={document?.status ?? null}
            documentStatusText={
              document ? t(`glossary.documentStatus.${document.status}`) : t("home.tiles.documentNotStarted")
            }
          />
        )}
      </Panel>

      {/* With tasks, the carousel itself is the named region; naming the panel too would nest two
          "Moje zadania" regions. */}
      <Panel labelledBy={tasks.length === 0 ? "my-tasks" : undefined}>
        {/* pr-28 keeps room for the carousel arrows drawn at the heading's right edge. */}
        <h2 id="my-tasks" className="min-h-11 pr-28 text-2xl leading-11 font-semibold text-ink">
          {t("home.myTasks")}
        </h2>
        <div className="mt-3">
          {tasks.length === 0 ? (
            <p className="text-ink-soft">{t("home.noTasks")}</p>
          ) : (
            <TaskCarousel
              labelledBy="my-tasks"
              tasks={tasks}
              labels={{
                previous: t("home.carousel.previous"),
                next: t("home.carousel.next"),
                open: t("common.open"),
              }}
            />
          )}
        </div>
      </Panel>
    </div>
  );
}

/** Turns task rules into translated card content (a new HomeTaskKind fails the switch at compile time). */
async function toTaskCards(tasks: readonly HomeTask[], year: number | null, locale: Locale): Promise<TaskCardData[]> {
  const t = await getTranslations("home");
  return tasks.map((task, index) => {
    const common = {
      id: task.kind,
      href: task.href,
      updatedLabel: task.updatedAt ? t("lastUpdated", { date: formatDate(task.updatedAt, locale) }) : null,
      slideLabel: t("carousel.slide", { index: index + 1, total: tasks.length }),
    };
    switch (task.kind) {
      case "FILL_GOALS":
        return {
          ...common,
          title: t("tasks.fillGoals"),
          description: t("tasks.fillGoalsDescription", { year: year ?? "" }),
        };
    }
  });
}

const YEAR_INFO_ID = "year-info";

/** HOME-10: the selected year stands out, with a small info button explaining where it comes from. */
function YearHighlight({ children, infoLabel }: { children: ReactNode; infoLabel: string }) {
  return (
    <span className="inline-flex items-start gap-0.5 whitespace-nowrap">
      {/* Gradient text; Windows high-contrast drops backgrounds, so fall back to the system text colour. */}
      <span className="bg-(image:--am-gradient) bg-clip-text text-transparent forced-colors:bg-none forced-colors:text-[CanvasText]">
        {children}
      </span>
      <button
        type="button"
        popoverTarget={YEAR_INFO_ID}
        aria-label={infoLabel}
        title={infoLabel}
        className="relative -mt-0.5 flex size-6 cursor-pointer items-center justify-center rounded-full text-accent transition-colors duration-200 after:absolute after:-inset-2.5 hover:bg-accent/10 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
      >
        <InfoIcon className="size-4" />
      </button>
    </span>
  );
}

// Native popover: keyboard and Esc support without client JS. Anchored under the info button
// where CSS anchor positioning exists; elsewhere the browser centres it in the viewport.
function YearInfoPopover({ text }: { text: string }) {
  return (
    <div
      id={YEAR_INFO_ID}
      popover="auto"
      className="m-auto w-max max-w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-line bg-surface p-4 text-sm leading-relaxed text-ink shadow-card supports-[position-area:bottom]:m-0 supports-[position-area:bottom]:mt-2 supports-[position-area:bottom]:[inset:auto] supports-[position-area:bottom]:[position-area:bottom_span-right] supports-[position-area:bottom]:[position-try-fallbacks:bottom_span-left,bottom]"
    >
      {text}
    </div>
  );
}

/** Card surface; a `<section>` becomes a named region only when `labelledBy` is given. */
function Panel({ children, labelledBy }: { children: ReactNode; labelledBy?: string }) {
  return (
    <section
      aria-labelledby={labelledBy}
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-10"
    >
      {children}
    </section>
  );
}
