import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { forbidden } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages, getTranslations } from "next-intl/server";
import { ChevronLeftIcon } from "@/components/shell/icons";
import type { ContentKey } from "@/domain/content-block";
import type { Locale } from "@/i18n/config";
import { formatDate } from "@/i18n/format";
import { loadContentForAdmin, type ContentBlockView } from "@/server/content-admin";
import { requireEmployee } from "@/server/current-employee";
import { db } from "@/server/db";
import { ContentBlockForm, type ContentVariant } from "./content-block-form";

// HR panel, content (HR-06, HOME-02/11/16): the start announcement, the start page intro text and
// the header link addresses, each in PL and EN, published as new versions. HR only: anyone else
// gets the 403 boundary (forbidden.tsx); the Server Action checks HR again.

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();
  return { title: t("header.screen", { app: t("common.appName"), screen: t("admin.content.title") }) };
}

export default async function ContentPage() {
  const t = await getTranslations("common");
  return (
    <Suspense fallback={<p className="text-ink-soft">{t("loading")}</p>}>
      <GuardedContent />
    </Suspense>
  );
}

type BlockMessage =
  | "startAnnouncement"
  | "startAnnouncementHint"
  | "welcomeText"
  | "welcomeTextHint"
  | "hrContactsLink"
  | "hrContactsLinkHint"
  | "toolkitLink"
  | "toolkitLinkHint";

const BLOCKS: ReadonlyArray<{ key: ContentKey; variant: ContentVariant; title: BlockMessage; description: BlockMessage }> = [
  { key: "KOMUNIKAT_STARTOWY", variant: "announcement", title: "startAnnouncement", description: "startAnnouncementHint" },
  { key: "TEKST_POWITALNY", variant: "intro", title: "welcomeText", description: "welcomeTextHint" },
  { key: "LINK_KONTAKTY_HR", variant: "link", title: "hrContactsLink", description: "hrContactsLinkHint" },
  { key: "LINK_GEDP_TOOLKIT", variant: "link", title: "toolkitLink", description: "toolkitLinkHint" },
];

async function GuardedContent() {
  const viewer = await requireEmployee();
  if (!viewer.isHrAdmin) forbidden();

  const [blocks, t, locale] = await Promise.all([
    loadContentForAdmin(db(), viewer),
    getTranslations("admin"),
    getLocale(),
  ]);
  const byKey = new Map<ContentKey, ContentBlockView>(blocks.map((block) => [block.key, block]));

  // The client forms get only the messages they render.
  const { admin, header } = await getMessages();
  const clientMessages = { admin: { content: admin.content }, header: { opensInNewTab: header.opensInNewTab } };

  const versionLabel = (block: ContentBlockView): string =>
    block.version !== null && block.publishedAt !== null
      ? t("content.versionLabel", { version: block.version, date: formatDate(block.publishedAt, locale as Locale) })
      : t("content.neverPublished");

  const formFor = ({ key, variant, title, description }: (typeof BLOCKS)[number]) => {
    const block = byKey.get(key);
    if (!block) throw new Error(`Content block ${key} missing from the admin load`);
    return (
      <ContentBlockForm
        key={key}
        contentKey={key}
        variant={variant}
        title={t(`content.${title}`)}
        description={t(`content.${description}`)}
        versionLabel={versionLabel(block)}
        version={block.version}
        contentPl={block.contentPl}
        contentEn={block.contentEn}
        headingLevel={variant === "link" ? "h3" : "h2"}
      />
    );
  };

  return (
    <section
      aria-labelledby="screen-title"
      className="rounded-3xl border border-surface/90 bg-surface/75 p-6 shadow-card backdrop-blur-xl sm:p-8"
    >
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center gap-1 rounded-lg font-semibold text-accent underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <ChevronLeftIcon className="size-4" />
        {t("title")}
      </Link>
      <h1 id="screen-title" className="mt-2 text-2xl font-semibold text-ink sm:text-3xl">
        {t("content.title")}
      </h1>
      <p className="mt-2 max-w-prose text-ink-soft">{t("content.intro")}</p>

      <NextIntlClientProvider messages={clientMessages}>
        <div className="mt-8 flex flex-col gap-6">
          {BLOCKS.filter((block) => block.variant !== "link").map(formFor)}
          <section aria-labelledby="header-links-title" className="flex flex-col gap-4 pt-4">
            <div>
              <h2 id="header-links-title" className="text-xl font-semibold text-ink">
                {t("content.headerLinks")}
              </h2>
              <p className="mt-1 max-w-prose text-sm text-ink-soft">{t("content.headerLinksHint")}</p>
            </div>
            <div className="grid gap-6 xl:grid-cols-2">{BLOCKS.filter((block) => block.variant === "link").map(formFor)}</div>
          </section>
        </div>
      </NextIntlClientProvider>
    </section>
  );
}
