import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { AppFooter } from "@/components/shell/app-footer";
import { AppHeader } from "@/components/shell/app-header";

// Shell for every signed-in screen: header with tabs, page content, footer (HOME-12/16, NFR-04/05).
// /login and /no-access live outside this group and keep their own card layout.
// The shell only renders. Pages that read data must check access themselves (requireEmployee /
// requireTab); the static empty-state tabs read nothing and rely on the proxy session gate.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("header");
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-full bg-surface px-4 py-2 font-semibold text-accent shadow-panel focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50"
      >
        {t("skipToContent")}
      </a>
      <AppHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 outline-none sm:px-6 sm:py-12">
        {children}
      </main>
      <AppFooter />
    </>
  );
}
