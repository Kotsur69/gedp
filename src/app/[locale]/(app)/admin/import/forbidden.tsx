import Link from "next/link";
import { getTranslations } from "next-intl/server";

// 403 boundary for the HR import screen: shown when page.tsx calls forbidden() for a non-HR user.
export default async function ImportForbidden() {
  const t = await getTranslations("errors");
  return (
    <section aria-labelledby="forbidden-title" className="rounded-2xl border border-line bg-surface p-8">
      <h1 id="forbidden-title" className="text-2xl font-semibold text-ink">
        403
      </h1>
      <p className="mt-3 text-ink-soft">{t("forbidden")}</p>
      <Link href="/" className="mt-6 inline-block font-semibold text-accent underline-offset-4 hover:underline">
        {t("backHome")}
      </Link>
    </section>
  );
}
