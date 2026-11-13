import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";

type BrandCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

/** Frosted card with the logo stacked above the title - the AMSteel_Quote login layout. */
export function BrandCard({ title, subtitle, children }: BrandCardProps) {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border border-white/90 bg-white/75 p-8 shadow-card backdrop-blur-xl">
        <header className="mb-8 flex flex-col items-start gap-3.5">
          <BrandLogo priority className="h-[60px] w-auto" />
          <div>
            <h1 className="text-xl font-semibold text-ink">{title}</h1>
            <p className="text-sm text-ink-soft">{subtitle}</p>
          </div>
        </header>
        {children}
        <p className="mt-6 text-center text-xs text-ink-soft">© 2026 · Global Employee Development Program</p>
      </div>
    </main>
  );
}
