"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ImportCounts } from "@/server/import/pipeline";
import { confirmStructureImport, previewStructureImport, type ImportActionErrorCode } from "./actions";
import { ChangeTable, ErrorTable } from "./preview-tables";
import type { PreviewView } from "./preview-view";

// HR import screen, three steps: 1) upload -> 2) preview (counts + tables, nothing saved) ->
// 3) "Zatwierdź import" (valid rows only) or "Odrzuć całość". The file stays in the browser between
// steps and is sent again on confirm: the server re-plans it and checks the preview fingerprint,
// so it never writes anything HR did not see. Rejecting needs no server call: nothing was written.

type Outcome = { kind: "imported"; counts: ImportCounts } | { kind: "rejected" };

/**
 * Server codes plus NETWORK: the action call itself failed (connection lost, body over the limit,
 * server error) and the client cannot know whether a confirm committed.
 */
type FailureCode = ImportActionErrorCode | "NETWORK";

type ImportScreenProps = {
  maxFileBytes: number;
  maxFileMb: number;
  /** File format instructions, rendered on the server (import-guide.tsx). */
  guide: ReactNode;
};

const ACCEPT = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
const SECONDARY_BUTTON =
  "h-11 cursor-pointer rounded-xl border border-line-strong bg-white px-5 font-semibold text-ink hover:border-accent hover:text-accent disabled:cursor-wait disabled:opacity-60";

export function ImportScreen({ maxFileBytes, maxFileMb, guide }: ImportScreenProps) {
  const t = useTranslations("admin.import");
  const [isPending, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewView | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [failure, setFailure] = useState<FailureCode | null>(null);
  // Changing the key remounts the form, which clears the native file input.
  const [formKey, setFormKey] = useState(0);

  const reset = (next: Outcome | null, nextFailure: FailureCode | null = null) => {
    setFile(null);
    setPreview(null);
    setOutcome(next);
    setFailure(nextFailure);
    setFormKey((k) => k + 1);
  };

  const handleUpload = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const chosen = new FormData(event.currentTarget).get("file");
    setOutcome(null);
    setPreview(null);
    setFile(null);
    if (!(chosen instanceof File) || chosen.size === 0) return setFailure("NO_FILE");
    // Early, friendlier check; the server enforces the same limit.
    if (chosen.size > maxFileBytes) return setFailure("FILE_TOO_LARGE");
    setFailure(null);
    startTransition(async () => {
      const body = new FormData();
      body.set("file", chosen);
      let result: Awaited<ReturnType<typeof previewStructureImport>>;
      try {
        result = await previewStructureImport(body);
      } catch {
        // Preview never writes, so a failed call only needs a retry.
        return setFailure("FAILED");
      }
      if (!result.ok) return setFailure(result.code);
      setFile(chosen);
      setPreview(result.preview);
    });
  };

  const handleConfirm = () => {
    if (!file || !preview) return;
    setFailure(null);
    startTransition(async () => {
      const body = new FormData();
      body.set("file", file);
      body.set("fingerprint", preview.fingerprint);
      let result: Awaited<ReturnType<typeof confirmStructureImport>>;
      try {
        result = await confirmStructureImport(body);
      } catch {
        // The import may or may not have committed. Keep the preview: confirming again is safe,
        // because a committed import changes the data and the fingerprint check answers STALE.
        return setFailure("NETWORK");
      }
      // A stale preview can never be confirmed; HR has to upload the file again.
      if (!result.ok) return result.code === "STALE" ? reset(null, "STALE") : setFailure(result.code);
      reset({ kind: "imported", counts: result.counts });
    });
  };

  return (
    <section aria-labelledby="import-title" className="rounded-2xl border border-line bg-surface p-6 sm:p-8">
      <h1 id="import-title" className="text-2xl font-semibold text-ink">
        {t("title")}
      </h1>
      {guide}

      <form key={formKey} onSubmit={handleUpload} className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-col gap-1">
          <span className="font-semibold text-ink">{t("chooseFile")}</span>
          {/* Locked while a preview is open, so the input never shows a file other than the one being confirmed. */}
          <input
            type="file"
            name="file"
            accept={ACCEPT}
            required
            disabled={isPending || preview !== null}
            className="text-sm text-ink"
          />
          <span className="text-sm text-ink-soft">{t("fileHint", { mb: maxFileMb })}</span>
        </label>
        <button type="submit" disabled={isPending || preview !== null} className={SECONDARY_BUTTON}>
          {isPending && !preview ? t("uploading") : t("upload")}
        </button>
      </form>

      <div aria-live="polite" className="mt-4">
        {failure && <p className="font-semibold text-danger">{t(`failure.${failure}`, { mb: maxFileMb })}</p>}
        {outcome && <OutcomeMessage outcome={outcome} />}
      </div>

      {preview && (
        <PreviewSection
          preview={preview}
          isPending={isPending}
          onConfirm={handleConfirm}
          onReject={() => reset({ kind: "rejected" })}
        />
      )}
    </section>
  );
}

function OutcomeMessage({ outcome }: { outcome: Outcome }) {
  const t = useTranslations("admin.import");
  if (outcome.kind === "rejected") return <p className="font-semibold text-ink">{t("rejected")}</p>;
  const { newCount, changedCount, deactivatedCount, errorCount } = outcome.counts;
  const message = t("imported", {
    created: newCount,
    changed: changedCount,
    deactivated: deactivatedCount,
    errors: errorCount,
  });
  return <p className="font-semibold text-ink">{message}</p>;
}

type PreviewSectionProps = {
  preview: PreviewView;
  isPending: boolean;
  onConfirm: () => void;
  onReject: () => void;
};

function PreviewSection({ preview, isPending, onConfirm, onReject }: PreviewSectionProps) {
  const t = useTranslations("admin.import");
  const { counts } = preview;
  const isBlocked = preview.fileErrors.length > 0;
  return (
    <div className="mt-8 border-t border-line pt-6">
      <h2 className="text-xl font-semibold text-ink">{t("preview")}</h2>
      <p className="mt-1 text-ink-soft">{t("fileName", { name: preview.fileName })}</p>
      <p className="mt-2 rounded-xl bg-notice-surface px-4 py-3 text-notice">{t("nothingSaved")}</p>

      <ul className="mt-4 grid gap-1 text-ink sm:grid-cols-3">
        <li>{t("totalRows", { count: preview.totalRows })}</li>
        <li>{t("new", { count: counts.created })}</li>
        <li>{t("changed", { count: counts.changed })}</li>
        <li>{t("deactivated", { count: counts.deactivated })}</li>
        <li>{t("unchanged", { count: preview.unchangedCount })}</li>
        <li>{t("errors", { count: preview.errorRowCount })}</li>
      </ul>

      {isBlocked && (
        <ErrorTable title={t("fileErrorsTitle")} issues={preview.fileErrors} total={preview.fileErrors.length} />
      )}
      <ErrorTable title={t("errorReasons", { count: counts.errors })} issues={preview.errors} total={counts.errors} />
      <ChangeTable title={t("new", { count: counts.created })} rows={preview.created} total={counts.created} showChanges={false} />
      <ChangeTable title={t("changed", { count: counts.changed })} rows={preview.changed} total={counts.changed} showChanges />
      <ChangeTable
        title={t("deactivated", { count: counts.deactivated })}
        rows={preview.deactivated}
        total={counts.deactivated}
        showChanges={false}
      />

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isBlocked || isPending}
          className="h-12 cursor-pointer rounded-xl bg-(image:--am-gradient) px-6 font-semibold tracking-[0.06em] text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isPending ? t("confirming") : t("confirm")}
        </button>
        <button type="button" onClick={onReject} disabled={isPending} className={SECONDARY_BUTTON}>
          {t("rejectAll")}
        </button>
        <p className="text-sm text-ink-soft">{t("confirmHint")}</p>
      </div>
    </div>
  );
}
