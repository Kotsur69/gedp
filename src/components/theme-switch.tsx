import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { resolveTheme, THEME_COOKIE } from "@/theme/config";

/** Server wrapper: reads the stored theme and passes labels to the client switcher. */
export async function ThemeSwitch() {
  const [store, t] = await Promise.all([cookies(), getTranslations("common.theme")]);
  const current = resolveTheme(store.get(THEME_COOKIE)?.value);
  return (
    <ThemeSwitcher
      // A new server value (e.g. changed in another tab) resets the client state.
      key={current}
      current={current}
      label={t("label")}
      names={{ light: t("light"), dark: t("dark"), system: t("system") }}
      errorMessage={t("saveFailed")}
    />
  );
}
