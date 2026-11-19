import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { screenMetadata } from "@/components/shell/empty-tab";
import { requireTab } from "@/server/navigation";

export function generateMetadata() {
  return screenMetadata("administrator");
}

// "Administrator" (HOME-12): HR only; anyone else gets 404. Entry point of the HR panel; sections
// are added here as they are built (today: the structure import, HR-01..03, employees, HR-04 + WF-09, cycles, HR-05,
// and documents, WF-08).
export default function AdminPage() {
  return (
    <Suspense fallback={null}>
      <GuardedAdmin />
    </Suspense>
  );
}

async function GuardedAdmin() {
  await requireTab("administrator");
  const t = await getTranslations("admin");
  return (
    <section
      aria-labelledby="screen-title"
      className="rounded-3xl border border-surface/90 bg-surface/75 p-8 shadow-card backdrop-blur-xl sm:p-12"
    >
      <h1 id="screen-title" className="text-2xl font-semibold text-ink sm:text-3xl">
        {t("title")}
      </h1>
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        <li>
          <Link
            href="/admin/import"
            className="block rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:border-accent focus-visible:border-accent motion-reduce:transition-none"
          >
            <span className="block font-semibold text-ink">{t("sections.import")}</span>
            <span className="mt-1 block text-sm text-ink-soft">{t("import.title")}</span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/employees"
            className="block rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:border-accent focus-visible:border-accent motion-reduce:transition-none"
          >
            <span className="block font-semibold text-ink">{t("sections.employees")}</span>
            <span className="mt-1 block text-sm text-ink-soft">{t("employees.edit.title")}</span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/cycles"
            className="block rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:border-accent focus-visible:border-accent motion-reduce:transition-none"
          >
            <span className="block font-semibold text-ink">{t("sections.cycles")}</span>
            <span className="mt-1 block text-sm text-ink-soft">{t("cycles.cardHint")}</span>
          </Link>
        </li>
        <li>
          <Link
            href="/admin/documents"
            className="block rounded-2xl border border-line bg-surface p-5 transition duration-200 hover:border-accent focus-visible:border-accent motion-reduce:transition-none"
          >
            <span className="block font-semibold text-ink">{t("sections.documents")}</span>
            <span className="mt-1 block text-sm text-ink-soft">{t("documents.cardHint")}</span>
          </Link>
        </li>
      </ul>
    </section>
  );
}
