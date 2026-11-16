import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CompassIcon } from "@/components/shell/icons";
import type { TabId } from "@/components/shell/tabs";

/** Browser tab title "GEDP 2027 – Moje informacje", so the page title follows the screen. */
export async function screenMetadata(tab: TabId): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t(`nav.${tab}`) }) };
}

type EmptyTabProps = {
  tab: TabId;
  /** `emptyTab`: content still to be agreed with HR (Q-15). `comingSoon`: content specified, not built yet. */
  reason: "emptyTab" | "comingSoon";
};

/** Empty state for a tab whose screen does not exist yet: names the tab and says why it is empty. */
export async function EmptyTab({ tab, reason }: EmptyTabProps) {
  const t = await getTranslations("nav");
  return (
    <section
      aria-labelledby="screen-title"
      className="relative overflow-hidden rounded-3xl border border-surface/90 bg-surface/75 p-8 shadow-card backdrop-blur-xl sm:p-12"
    >
      <span
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-2xl bg-(image:--am-gradient) text-on-brand shadow-panel"
      >
        <CompassIcon className="size-7" />
      </span>
      <h1 id="screen-title" className="mt-6 text-2xl font-semibold text-ink sm:text-3xl">
        {t(tab)}
      </h1>
      <p className="mt-3 max-w-xl leading-relaxed text-ink-soft">{t(reason)}</p>
    </section>
  );
}
