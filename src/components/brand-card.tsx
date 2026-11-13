import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { BrandLogo } from "@/components/brand-logo";
import { LanguageSwitch } from "@/components/language-switch";

type BrandCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

// Copyright year of the program, not the cycle year.
const COPYRIGHT_YEAR = 2026;

/** Frosted card with the logo stacked above the title - the AMSteel_Quote login layout. */
export async function BrandCard({ title, subtitle, children }: BrandCardProps) {
  const t = await getTranslations("common");
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/90 bg-white/75 p-8 shadow-card backdrop-blur-xl">
        <header className="mb-8 flex flex-col items-start gap-3.5">
          <div className="flex w-full items-start justify-between gap-4">
            <BrandLogo priority className="h-[60px] w-auto" />
            <LanguageSwitch />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            <p className="text-sm text-ink-soft">{subtitle}</p>
          </div>
        </header>
        {children}
        <p className="mt-6 text-center text-xs text-ink-soft">{t("footer", { year: COPYRIGHT_YEAR })}</p>
      </div>
    </main>
  );
}
