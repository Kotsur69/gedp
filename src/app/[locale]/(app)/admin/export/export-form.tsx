"use client";

import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import {
  EXPORT_DATA_TYPES,
  EXPORT_FORMATS,
  isFormatAllowed,
  type ExportDataType,
  type ExportErrorCode,
  type ExportFormat,
  type ExportPreview,
  type ExportRequestInput,
} from "@/domain/data-export";
import { AMEI_PATTERN } from "@/server/import/structure-columns";
import { downloadExportAction, previewExportAction } from "./actions";
import { ExportPreviewPanel } from "./export-preview";
import { CHOICE_CARD, CONTROL, SECONDARY_BUTTON } from "./form-styles";
import { PEOPLE_OPTIONS_ID, PeopleScopeField, type PeopleScopeState } from "./people-scope-field";

// HR export form (HR-08 + HR-12): WHAT (data types), WHICH YEAR, WHO, format -> "Pokaż podgląd"
// (people + records, nothing written) -> "Pobierz". Download is offered only for the exact choice the
// preview was made for: changing anything drops the preview, so HR never downloads unseen counts.
// The server validates and scopes everything again; this form only collects the choice.

/** `key` = the choice the failure belongs to; changing the form hides it, like the preview. */
type Failure = { key: string | null; code: ExportErrorCode | "INCOMPLETE"; ameis?: string[] };

type ExportFormProps = {
  years: readonly number[];
  defaultYear: number;
  departments: readonly string[];
  people: readonly { amei: string; name: string }[];
};

function toRequest(
  dataTypes: readonly ExportDataType[],
  year: number,
  scope: PeopleScopeState,
  format: ExportFormat,
): ExportRequestInput | null {
  if (dataTypes.length === 0 || !isFormatAllowed(format, dataTypes.length)) return null;
  const base = { dataTypes: [...dataTypes], year, format };
  switch (scope.kind) {
    case "one":
      return AMEI_PATTERN.test(scope.amei) ? { ...base, people: { kind: "one", amei: scope.amei } } : null;
    case "selected":
      return scope.ameis.length > 0 ? { ...base, people: { kind: "selected", ameis: scope.ameis } } : null;
    case "department":
      return scope.department ? { ...base, people: { kind: "department", department: scope.department } } : null;
    case "all":
      return { ...base, people: { kind: "all" } };
  }
}

function saveFile(fileName: string, mimeType: string, base64: string): void {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  // Attached, and revoked a tick later: some browsers cancel a download whose URL is revoked at once.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportForm({ years, defaultYear, departments, people }: ExportFormProps) {
  const t = useTranslations("admin.export");
  const [isPending, startTransition] = useTransition();
  const [dataTypes, setDataTypes] = useState<ExportDataType[]>([]);
  const [year, setYear] = useState(defaultYear);
  const [scope, setScope] = useState<PeopleScopeState>({ kind: "all", amei: "", ameis: [], department: "" });
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [preview, setPreview] = useState<{ key: string; preview: ExportPreview } | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [downloaded, setDownloaded] = useState<{ key: string; fileName: string } | null>(null);

  const names = useMemo(() => new Map(people.map((person) => [person.amei, person.name])), [people]);
  const request = toRequest(dataTypes, year, scope, format);
  const requestKey = request ? JSON.stringify(request) : null;
  const currentPreview = preview && preview.key === requestKey ? preview.preview : null;
  const csvBlocked = format === "csv" && dataTypes.length > 1;
  const currentFailure = failure && failure.key === requestKey ? failure : null;

  const toggleType = (type: ExportDataType) => {
    const next = dataTypes.includes(type) ? dataTypes.filter((item) => item !== type) : [...dataTypes, type];
    setDataTypes(EXPORT_DATA_TYPES.filter((item) => next.includes(item)));
  };

  const runPreview = () => {
    if (!request || !requestKey) {
      return setFailure({ key: requestKey, code: csvBlocked ? "CSV_SINGLE_TYPE" : "INCOMPLETE" });
    }
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await previewExportAction(request);
        if (!result.ok) return setFailure({ key: requestKey, code: result.code, ameis: result.ameis });
        setPreview({ key: requestKey, preview: result.preview });
      } catch {
        setFailure({ key: requestKey, code: "FAILED" });
      }
    });
  };

  const runDownload = () => {
    if (!request || !requestKey || !currentPreview) return;
    setFailure(null);
    startTransition(async () => {
      try {
        const result = await downloadExportAction(request);
        if (!result.ok) return setFailure({ key: requestKey, code: result.code, ameis: result.ameis });
        saveFile(result.fileName, result.mimeType, result.base64);
        setPreview({ key: requestKey, preview: result.preview });
        setDownloaded({ key: requestKey, fileName: result.fileName });
      } catch {
        setFailure({ key: requestKey, code: "FAILED" });
      }
    });
  };

  return (
    <div className="mt-6 grid gap-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <fieldset className="rounded-2xl border border-line bg-surface p-4 sm:p-5" disabled={isPending}>
          <legend className="px-1 text-base font-semibold text-ink">{t("whichData")}</legend>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            {EXPORT_DATA_TYPES.map((type) => (
              <label key={type} className={CHOICE_CARD}>
                <input
                  type="checkbox"
                  checked={dataTypes.includes(type)}
                  onChange={() => toggleType(type)}
                  className="mt-0.5 size-4 shrink-0 accent-(--color-accent)"
                />
                <span>
                  <span className="block font-semibold text-ink">{t(`dataTypes.${type}.label`)}</span>
                  <span className="mt-0.5 block text-sm text-ink-soft">{t(`dataTypes.${type}.hint`)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid content-start gap-5">
          <fieldset className="rounded-2xl border border-line bg-surface p-4 sm:p-5" disabled={isPending}>
            <legend className="px-1 text-base font-semibold text-ink">{t("whichYear")}</legend>
            <label htmlFor="export-year" className="sr-only">
              {t("whichYear")}
            </label>
            <select id="export-year" value={year} onChange={(event) => setYear(Number(event.target.value))} className={CONTROL}>
              {years.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </fieldset>

          <fieldset className="rounded-2xl border border-line bg-surface p-4 sm:p-5" disabled={isPending}>
            <legend className="px-1 text-base font-semibold text-ink">{t("format")}</legend>
            <div className="mt-1 grid gap-2">
              {EXPORT_FORMATS.map((option) => (
                <label key={option} className={CHOICE_CARD}>
                  <input
                    type="radio"
                    name="export-format"
                    value={option}
                    checked={format === option}
                    onChange={() => setFormat(option)}
                    className="mt-0.5 size-4 shrink-0 accent-(--color-accent)"
                  />
                  <span>
                    <span className="block font-semibold text-ink">{t(`formats.${option}.label`)}</span>
                    <span className="mt-0.5 block text-sm text-ink-soft">{t(`formats.${option}.hint`)}</span>
                  </span>
                </label>
              ))}
            </div>
            {csvBlocked && (
              <p className="mt-3 rounded-xl bg-notice-surface px-3 py-2 text-sm font-semibold text-notice">
                {t("failure.CSV_SINGLE_TYPE")}
              </p>
            )}
          </fieldset>
        </div>
      </div>

      <PeopleScopeField value={scope} onChange={setScope} departments={departments} names={names} disabled={isPending} />
      <datalist id={PEOPLE_OPTIONS_ID}>
        {people.map((person) => (
          <option key={person.amei} value={person.amei} label={`${person.name} (${person.amei})`} />
        ))}
      </datalist>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={runPreview} disabled={isPending} className={SECONDARY_BUTTON}>
          {isPending && !currentPreview ? t("previewing") : t("showPreview")}
        </button>
        <p className="text-sm text-ink-soft">{t("previewHint")}</p>
      </div>

      <div aria-live="polite">
        {currentFailure && (
          <p role="alert" className="font-semibold text-danger">
            {t(`failure.${currentFailure.code}`)}
            {currentFailure.ameis && currentFailure.ameis.length > 0 && ` ${currentFailure.ameis.join(", ")}`}
          </p>
        )}
      </div>

      {currentPreview && (
        <ExportPreviewPanel
          preview={currentPreview}
          year={year}
          format={format}
          isPending={isPending}
          downloaded={downloaded?.key === requestKey ? downloaded.fileName : null}
          onDownload={runDownload}
        />
      )}
    </div>
  );
}
