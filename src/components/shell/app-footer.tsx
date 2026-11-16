import { getLocale, getTranslations } from "next-intl/server";
import { formatDate } from "@/i18n/format";

// Noon UTC keeps the calendar day the same in company time (Europe/Warsaw) whatever the offset.
const RELEASE_DATE_TIME = "T12:00:00Z";

/** Footer with the app version and release date (NFR-04). Static: both values are build-time. */
export async function AppFooter() {
  const [t, locale] = await Promise.all([getTranslations("common"), getLocale()]);
  // Set in next.config.ts `env`; missing values mean the build config was changed, not bad input.
  const version = process.env.APP_VERSION;
  const releasedOn = process.env.APP_RELEASE_DATE;
  if (!version || !releasedOn) throw new Error("APP_VERSION / APP_RELEASE_DATE are not set (next.config.ts env)");

  return (
    <footer className="border-t border-line">
      <p className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-ink-soft tabular-nums sm:px-6">
        {t("version", { version, date: formatDate(new Date(`${releasedOn}${RELEASE_DATE_TIME}`), locale) })}
      </p>
    </footer>
  );
}
