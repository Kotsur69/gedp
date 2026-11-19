"use client";

import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/shell/icons";
import { EXPORT_DATA_TYPES, type ExportFormat, type ExportPreview } from "@/domain/data-export";
import { PRIMARY_BUTTON } from "./form-styles";

// Preview of an export (HR-12): how many people and how many records per data type the file will
// hold, before anything is downloaded. "Pobierz" lives here, so it only exists next to fresh counts.

type ExportPreviewPanelProps = {
  preview: ExportPreview;
  year: number;
  format: ExportFormat;
  isPending: boolean;
  downloaded: string | null;
  onDownload: () => void;
};

export function ExportPreviewPanel({ preview, year, format, isPending, downloaded, onDownload }: ExportPreviewPanelProps) {
  const t = useTranslations("admin.export");
  const types = EXPORT_DATA_TYPES.filter((type) => preview.records[type] !== undefined);
  const total = types.reduce((sum, type) => sum + (preview.records[type] ?? 0), 0);
  const isEmpty = preview.people === 0;

  return (
    <section
      aria-labelledby="export-preview-title"
      className="rounded-2xl border border-accent/40 bg-canvas p-4 shadow-card sm:p-6"
    >
      <h2 id="export-preview-title" className="text-lg font-semibold text-ink">
        {t("previewTitle", { year })}
      </h2>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:max-w-md">
        <div className="rounded-xl bg-surface p-4">
          <dt className="text-sm text-ink-soft">{t("peopleCount")}</dt>
          <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">{preview.people}</dd>
        </div>
        <div className="rounded-xl bg-surface p-4">
          <dt className="text-sm text-ink-soft">{t("recordsCount")}</dt>
          <dd className="mt-1 text-3xl font-semibold text-ink tabular-nums">{total}</dd>
        </div>
      </dl>

      <table className="mt-4 w-full max-w-xl text-left text-sm">
        <caption className="sr-only">{t("recordsCaption")}</caption>
        <thead>
          <tr className="border-b border-line text-ink-soft">
            <th scope="col" className="py-2 pr-4 font-semibold">
              {t(format === "xlsx" ? "sheet" : "table")}
            </th>
            <th scope="col" className="py-2 text-right font-semibold">
              {t("records")}
            </th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type} className="border-b border-line last:border-0">
              <td className="py-2 pr-4 text-ink">{t(`dataTypes.${type}.label`)}</td>
              <td className="py-2 text-right font-semibold text-ink tabular-nums">{preview.records[type]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={onDownload} disabled={isPending || isEmpty} className={PRIMARY_BUTTON}>
          {isPending ? t("downloading") : t("download")}
        </button>
        <p className="text-sm text-ink-soft">{isEmpty ? t("failure.NO_PEOPLE") : t("auditNote")}</p>
      </div>
      {downloaded && (
        <p role="status" className="mt-3 flex items-center gap-2 font-semibold text-ink">
          <CheckIcon className="size-4 text-accent" />
          {t("downloaded", { fileName: downloaded })}
        </p>
      )}
    </section>
  );
}
