"use client";

import { useDeferredValue, useRef, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "@/components/goals/goal-field";
import { IntroMarkdown } from "@/components/home/intro-markdown";
import { BoldIcon, HeadingIcon, LinkIcon, ListIcon } from "@/components/shell/icons";
import { MAX_MARKDOWN_LENGTH } from "@/domain/content-block";
import { prefixLines, wrapSelection, type TextEdit } from "./markdown-edit";

// One language of an HR markdown block (HR-06): toolbar, textarea and a live preview drawn by the
// SAME sanitising renderer the start page uses, so what HR sees is what employees get (raw HTML
// and unsafe links are dropped there too).

const TOOL_BUTTON =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors duration-200 hover:bg-accent/10 hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 motion-reduce:transition-none";

interface MarkdownFieldProps {
  id: string;
  label: string;
  lang: "pl" | "en";
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  /** Announcement: headings are kept; the intro text drops them, so no heading button. */
  allowsHeadings: boolean;
  isBusy: boolean;
  /** Frame of the preview, so it resembles where the text is shown. */
  previewFrame: (preview: ReactNode) => ReactNode;
}

export function MarkdownField({ id, label, lang, value, onChange, error, allowsHeadings, isBusy, previewFrame }: MarkdownFieldProps) {
  const t = useTranslations("admin.content");
  const tHeader = useTranslations("header");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Typing stays responsive on long texts; the preview catches up a frame later.
  const preview = useDeferredValue(value);

  const apply = (edit: (current: string, start: number, end: number) => TextEdit) => {
    const textarea = textareaRef.current;
    if (!textarea || isBusy) return;
    const next = edit(value, textarea.selectionStart, textarea.selectionEnd);
    onChange(next.value);
    // After React has written the new value, select the inserted part so typing replaces it.
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(next.selectionStart, next.selectionEnd);
    });
  };

  const tools = [
    ...(allowsHeadings
      ? [{ label: t("toolbar.heading"), icon: <HeadingIcon />, edit: (v: string, s: number, e: number) => prefixLines(v, s, e, "## ", t("toolbar.headingPlaceholder")) }]
      : []),
    { label: t("toolbar.bold"), icon: <BoldIcon />, edit: (v: string, s: number, e: number) => wrapSelection(v, s, e, "**", "**", t("toolbar.boldPlaceholder")) },
    { label: t("toolbar.list"), icon: <ListIcon />, edit: (v: string, s: number, e: number) => prefixLines(v, s, e, "- ", t("toolbar.listPlaceholder")) },
    { label: t("toolbar.link"), icon: <LinkIcon />, edit: (v: string, s: number, e: number) => wrapSelection(v, s, e, "[", "](https://)", t("toolbar.linkPlaceholder")) },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <GoalField
        id={id}
        label={label}
        hint={allowsHeadings ? t("markdownHintHeadings") : t("markdownHint")}
        error={error}
      >
        <div className="overflow-hidden rounded-xl border border-line-strong bg-surface transition-colors duration-200 focus-within:border-accent has-aria-invalid:border-danger motion-reduce:transition-none">
          <div role="group" aria-label={t("toolbar.label", { field: label })} className="flex gap-1 border-b border-line bg-canvas px-1.5 py-1">
            {tools.map((tool) => (
              <button
                key={tool.label}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                aria-disabled={isBusy || undefined}
                onClick={() => apply(tool.edit)}
                className={TOOL_BUTTON}
              >
                {tool.icon}
              </button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            {...describedControl(id, error !== null)}
            lang={lang}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            readOnly={isBusy}
            // One over the limit, so the schema can say "too long" instead of the browser cutting silently.
            maxLength={MAX_MARKDOWN_LENGTH + 1}
            rows={12}
            spellCheck
            className={`${GOAL_CONTROL_CLASSES} min-h-64 resize-y rounded-none border-0 font-mono text-sm leading-relaxed hover:border-0 focus-visible:outline-0 read-only:bg-canvas`}
          />
        </div>
      </GoalField>
      <div className="flex min-w-0 flex-col">
        <p className="text-sm font-semibold text-ink">{t("previewOf", { field: label })}</p>
        <div lang={lang} className="mt-2 min-w-0 flex-1">
          {previewFrame(
            preview.trim() === "" ? (
              <p className="text-ink-soft italic">{t("previewEmpty")}</p>
            ) : (
              <IntroMarkdown markdown={preview} newTabLabel={tHeader("opensInNewTab")} headings={allowsHeadings} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
