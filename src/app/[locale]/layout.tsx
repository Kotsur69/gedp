import type { Metadata } from "next";
import localFont from "next/font/local";
import { getLocale, getTranslations } from "next-intl/server";
import { LOCALES } from "@/i18n/config";
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

// One static shell per language; proxy.ts picks the language from the cookie.
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("appName"), description: t("metaDescription") };
}

export default async function RootLayout({ children }: LayoutProps<"/[locale]">) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${gilroy.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
