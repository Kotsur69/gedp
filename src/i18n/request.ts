import { notFound } from "next/navigation";
import * as rootParams from "next/root-params";
import { getRequestConfig } from "next-intl/server";
import { isLocale } from "@/i18n/config";
import { TIME_ZONE } from "@/i18n/format";

// The locale comes from the /[locale] root segment that proxy.ts rewrites to. Reading it via
// next/root-params keeps pages statically renderable under cacheComponents.
// Server Actions have no root params: pass the locale explicitly there,
// e.g. getTranslations({ locale, namespace }).
export default getRequestConfig(async ({ locale }) => {
  const requested = locale ?? (await rootParams.locale());
  if (!isLocale(requested)) notFound();
  return {
    locale: requested,
    messages: (await import(`../../messages/${requested}.json`)).default,
    timeZone: TIME_ZONE,
  };
});
