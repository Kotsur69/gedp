import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/config";
import { resolveTheme, THEME_COOKIE } from "@/theme/config";
import "../globals.css";

// Gilroy: ArcelorMittal brand typeface (Branding/fonts). Regular for text, SemiBold for headings.
const gilroy = localFont({
  variable: "--font-gilroy",
  display: "swap",
  src: [
    { path: "../fonts/Gilroy-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Gilroy-SemiBold.woff2", weight: "600", style: "normal" },
  ],
});

// Both languages are known routes; proxy.ts picks the language from the cookie.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("appName"), description: t("metaDescription") };
}

// Nonce-based CSP (SEC-05, proxy.ts) needs every script tag rendered per request: a prerendered
// shell has no nonce and the browser blocks it. Suspense around the whole document plus
// connection() makes each route fully dynamic, so Next stamps the request nonce everywhere.
export default function RootLayout({ children }: LayoutProps<"/[locale]">) {
  return (
    <Suspense>
      <RootDocument>{children}</RootDocument>
    </Suspense>
  );
}

async function RootDocument({ children }: { children: ReactNode }) {
  await connection();
  const [locale, store] = await Promise.all([getLocale(), cookies()]);
  // The theme comes from the cookie on the server, so the first paint is already right (no flash).
  // The switcher sets the same attribute after hydration and saves the cookie, so they stay equal.
  const theme = resolveTheme(store.get(THEME_COOKIE)?.value);
  return (
    <html lang={locale} data-theme={theme} className={`${gilroy.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
