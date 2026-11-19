"use client";

import { useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "@/components/goals/goal-field";
import {
  contentFieldErrors,
  MAX_URL_LENGTH,
  publishContentSchema,
  type ContentFieldErrors,
  type ContentKey,
  type LatestContent,
} from "@/domain/content-block";
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from "../cycles/cycle-form-kit";
import { publishContentAction, type ContentActionErrorCode } from "./actions";
import { MarkdownField } from "./markdown-field";

// One HR content block (HR-06) in Polish and English with one "Publish" for both. The shared zod
// schema gives quick feedback; the Server Action validates again. Publishing the start
// announcement shows it to everyone once more, so that one asks for a confirmation first.
//
// The form publishes against the version it was opened on (baseVersion). When another HR user
// published meanwhile, the server refuses (STALE) and sends their version; HR then chooses to load
// it (own edits are dropped) or to keep their own text, which replaces it on the next publish.

export type ContentVariant = "announcement" | "intro" | "link";

const LANGUAGES = [
  { field: "contentPl", lang: "pl" },
  { field: "contentEn", lang: "en" },
] as const;

type Field = (typeof LANGUAGES)[number]["field"];

type Status =
  | { kind: "idle" }
  | { kind: "confirm" }
  | { kind: "published"; version: number | null }
  | { kind: "unchanged" }
  | { kind: "error"; code: ContentActionErrorCode; fieldErrors: ContentFieldErrors }
  | { kind: "conflict"; latest: LatestContent };

type ContentBlockFormProps = {
  contentKey: ContentKey;
  variant: ContentVariant;
  title: string;
  description: string;
  /** "Wersja 3, opublikowana 2 lutego 2027" or "not published yet", formatted on the server. */
  versionLabel: string;
  version: number | null;
  contentPl: string;
  contentEn: string;
  /** h3 when the form sits under a section heading (the two header links). */
  headingLevel: "h2" | "h3";
};

export function ContentBlockForm({
  contentKey,
  variant,
  title,
  description,
  versionLabel,
  version,
  contentPl,
  contentEn,
  headingLevel: Heading,
}: ContentBlockFormProps) {
  const t = useTranslations("admin.content");
  const router = useRouter();
  const [values, setValues] = useState({ contentPl, contentEn });
  const [baseVersion, setBaseVersion] = useState(version);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [isPending, startTransition] = useTransition();
  const submitRef = useRef<HTMLButtonElement>(null);
  const titleId = `content-${contentKey}-title`;
  const fieldErrors = status.kind === "error" ? status.fieldErrors : {};
  const errorOf = (field: Field) => (fieldErrors[field] ? t(`errors.${fieldErrors[field]}`) : null);

  const edit = (field: Field, value: string) => {
    if (isPending) return;
    setValues((current) => ({ ...current, [field]: value }));
    setStatus((current) => statusAfterEdit(current, field));
  };

  const resolveConflict = (latest: LatestContent, loadTheirs: boolean) => {
    if (loadTheirs) setValues({ contentPl: latest.contentPl, contentEn: latest.contentEn });
    setBaseVersion(latest.version);
    setStatus({ kind: "idle" });
    submitRef.current?.focus();
  };

  const publish = () => {
    const payload = { key: contentKey, baseVersion, ...values };
    startTransition(async () => {
      try {
        const result = await publishContentAction(payload);
        if (!result.ok) {
          if (result.code === "STALE" && result.latest) {
            // Updates the version label; the form keeps its state until HR chooses.
            router.refresh();
            return setStatus({ kind: "conflict", latest: result.latest });
          }
          return setStatus({ kind: "error", code: result.code, fieldErrors: result.fieldErrors });
        }
        setBaseVersion(result.version);
        setStatus(result.changed ? { kind: "published", version: result.version } : { kind: "unchanged" });
      } catch {
        // Network failure or a server error outside the action's own handling.
        setStatus({ kind: "error", code: "FAILED", fieldErrors: {} });
      }
    });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending || status.kind === "conflict") return;
    const parsed = publishContentSchema.safeParse({ key: contentKey, baseVersion, ...values });
    if (!parsed.success) {
      return setStatus({ kind: "error", code: "INVALID_INPUT", fieldErrors: contentFieldErrors(parsed.error) });
    }
    if (variant === "announcement" && status.kind !== "confirm") return setStatus({ kind: "confirm" });
    publish();
  };

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby={titleId}
      className="rounded-2xl border border-line bg-surface p-5 shadow-panel sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={titleId} className={`${Heading === "h2" ? "text-xl" : "text-lg"} font-semibold text-ink`}>
          {title}
        </Heading>
        <p className="text-sm text-ink-soft tabular-nums">{versionLabel}</p>
      </div>
      <p className="mt-1 max-w-prose text-sm text-ink-soft">{description}</p>

      <div className={variant === "link" ? "mt-5 grid gap-5 sm:grid-cols-2" : "mt-6 flex flex-col gap-8"}>
        {LANGUAGES.map(({ field, lang }) => {
          const id = `content-${contentKey}-${lang}`;
          const label = t(variant === "link" ? `urlLabel.${lang}` : `textLabel.${lang}`);
          return variant === "link" ? (
            <GoalField key={field} id={id} label={label} hint={t("urlHint")} error={errorOf(field)}>
              <input
                {...describedControl(id, errorOf(field) !== null)}
                type="url"
                inputMode="url"
                lang={lang}
                value={values[field]}
                onChange={(event) => edit(field, event.target.value)}
                readOnly={isPending}
                maxLength={MAX_URL_LENGTH + 1}
                autoComplete="off"
                spellCheck={false}
                placeholder="https://"
                className={`${GOAL_CONTROL_CLASSES} read-only:bg-canvas`}
              />
            </GoalField>
          ) : (
            <MarkdownField
              key={field}
              id={id}
              label={label}
              lang={lang}
              value={values[field]}
              onChange={(value) => edit(field, value)}
              error={errorOf(field)}
              allowsHeadings={variant === "announcement"}
              isBusy={isPending}
              previewFrame={variant === "announcement" ? (preview) => <AnnouncementFrame title={t("announcementTitle")}>{preview}</AnnouncementFrame> : (preview) => <IntroFrame>{preview}</IntroFrame>}
            />
          );
        })}
      </div>

      <div className="mt-6 flex flex-col gap-4 border-t border-line pt-5">
        {status.kind === "conflict" && (
          <ConflictNotice
            version={status.latest.version}
            onLoadTheirs={() => resolveConflict(status.latest, true)}
            onKeepMine={() => resolveConflict(status.latest, false)}
          />
        )}
        {status.kind === "confirm" && (
          <p role="alert" className="rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-notice">
            {t("announcementConfirm")}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <button
            ref={submitRef}
            type="submit"
            aria-disabled={isPending || status.kind === "conflict" || undefined}
            aria-busy={isPending || undefined}
            className={PRIMARY_BUTTON}
          >
            {status.kind === "confirm" ? t("confirmPublish") : t("publish")}
          </button>
          {status.kind === "confirm" && (
            <button
              type="button"
              onClick={() => {
                setStatus({ kind: "idle" });
                // The Cancel button disappears; keep focus on the form instead of dropping it to <body>.
                submitRef.current?.focus();
              }}
              className={SECONDARY_BUTTON}
            >
              {t("cancel")}
            </button>
          )}
          <PublishStatus status={status} isPending={isPending} />
        </div>
      </div>
    </form>
  );
}

/** Editing a field clears that field's error and any "published" / "confirm" notice. */
function statusAfterEdit(status: Status, field: Field): Status {
  if (status.kind === "published" || status.kind === "unchanged" || status.kind === "confirm") return { kind: "idle" };
  if (status.kind !== "error" || status.fieldErrors[field] === undefined) return status;
  const rest: ContentFieldErrors = Object.fromEntries(Object.entries(status.fieldErrors).filter(([name]) => name !== field));
  return Object.keys(rest).length === 0 ? { kind: "idle" } : { ...status, fieldErrors: rest };
}

type ConflictNoticeProps = {
  version: number;
  onLoadTheirs: () => void;
  onKeepMine: () => void;
};

/** STALE: another HR user published meanwhile; HR picks which text to continue with. */
function ConflictNotice({ version, onLoadTheirs, onKeepMine }: ConflictNoticeProps) {
  const t = useTranslations("admin.content");
  return (
    <div role="alert" className="flex flex-col gap-3 rounded-xl bg-notice-surface px-4 py-3">
      <p className="text-sm font-semibold text-notice">{t("conflict.text", { version })}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" onClick={onLoadTheirs} className={SECONDARY_BUTTON}>
          {t("conflict.loadTheirs")}
        </button>
        <button type="button" onClick={onKeepMine} className={SECONDARY_BUTTON}>
          {t("conflict.keepMine")}
        </button>
      </div>
    </div>
  );
}

function PublishStatus({ status, isPending }: { status: Status; isPending: boolean }) {
  const t = useTranslations("admin.content");
  if (status.kind === "error" && Object.keys(status.fieldErrors).length === 0) {
    return (
      <p role="alert" className="rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-danger">
        {t(`errors.${status.code}`)}
      </p>
    );
  }
  let text = "";
  if (isPending) text = t("publishing");
  else if (status.kind === "published") text = t("published", { version: status.version ?? 0 });
  else if (status.kind === "unchanged") text = t("unchanged");
  else if (status.kind === "error") text = t("errors.INVALID_INPUT");
  return (
    <p role="status" className="min-h-5 text-sm font-semibold text-ink-soft">
      {text}
    </p>
  );
}

/** Looks like the start announcement dialog: brand bar, title, body. */
function AnnouncementFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="h-full overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <span aria-hidden="true" className="block h-1 bg-(image:--am-gradient)" />
      <p aria-hidden="true" className="border-b border-line px-5 py-3 text-lg font-semibold text-ink">
        {title}
      </p>
      <div className="px-5 py-4">{children}</div>
    </div>
  );
}

/** Looks like the intro block on the start page panel. */
function IntroFrame({ children }: { children: ReactNode }) {
  return <div className="h-full rounded-2xl border border-line bg-canvas p-5">{children}</div>;
}
