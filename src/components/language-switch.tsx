import { getLocale, getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/locale-switcher";

/** Server wrapper: resolves the current locale and labels for the client switcher. */
export async function LanguageSwitch() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("common.language")]);
  return <LocaleSwitcher current={locale} label={t("label")} names={{ pl: t("pl"), en: t("en") }} />;
}
