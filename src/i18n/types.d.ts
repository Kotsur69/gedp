import type messages from "../../messages/pl.json";
import type { Locale } from "@/i18n/config";

// Typed message keys: t("home.greeting") is checked at compile time against pl.json,
// and the parity test keeps en.json in step.
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
