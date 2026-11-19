"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import type { z } from "zod";
import { cycleConfigFieldErrors, type CycleConfigFieldErrors } from "@/domain/cycle-config";
import type { CycleActionErrorCode, CycleActionResult } from "./actions";

// Shared pieces of the HR cycle panel forms (HR-05): one save flow (shared zod schema first for
// quick feedback, then the Server Action, which validates again), the status line under a form and
// the button styles of the HR panel (same as the employee edit window).

export const PRIMARY_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none";
export const SECONDARY_BUTTON =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:border-line-strong aria-disabled:hover:text-ink motion-reduce:transition-none";
export const ICON_BUTTON =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-xl border border-line-strong bg-surface text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-40 aria-disabled:hover:border-line-strong aria-disabled:hover:text-ink motion-reduce:transition-none";

type Notice = "saved" | "unchanged" | null;

interface SaveState {
  fieldErrors: CycleConfigFieldErrors;
  /** An error that belongs to no field the form shows. */
  banner: CycleActionErrorCode | null;
  notice: Notice;
}

const IDLE: SaveState = { fieldErrors: {}, banner: null, notice: null };

export interface SaveRequest {
  schema: z.ZodType;
  payload: Record<string, unknown>;
  action: (payload: unknown) => Promise<CycleActionResult>;
  /** Field names the form shows; an error on any other field goes to the banner. */
  fields: readonly string[];
  onSaved?: (changed: boolean) => void;
}

export interface CycleSave extends SaveState {
  isPending: boolean;
  save: (request: SaveRequest) => void;
  /** The form changed after a save: "Zapisano." no longer describes it. Errors stay until the next save. */
  markEdited: () => void;
}

const onlyFields = (errors: CycleConfigFieldErrors, fields: readonly string[]): CycleConfigFieldErrors =>
  Object.fromEntries(Object.entries(errors).filter(([field]) => fields.includes(field)));

export function useCycleSave(): CycleSave {
  const [isPending, startTransition] = useTransition();
  const [state, setState] = useState<SaveState>(IDLE);

  const showErrors = (fieldErrors: CycleConfigFieldErrors, code: CycleActionErrorCode) => {
    const hasFieldError = Object.keys(fieldErrors).length > 0;
    setState({ fieldErrors, banner: hasFieldError ? null : code, notice: null });
  };

  const save = ({ schema, payload, action, fields, onSaved }: SaveRequest) => {
    if (isPending) return;
    const parsed = schema.safeParse(payload);
    if (!parsed.success) return showErrors(onlyFields(cycleConfigFieldErrors(parsed.error), fields), "INVALID_INPUT");
    setState(IDLE);
    startTransition(async () => {
      try {
        const result = await action(payload);
        if (!result.ok) return showErrors(onlyFields(result.fieldErrors, fields), result.code);
        setState({ ...IDLE, notice: result.changed ? "saved" : "unchanged" });
        onSaved?.(result.changed);
      } catch {
        // Network failure or a server error outside the action's own handling.
        showErrors({}, "FAILED");
      }
    });
  };

  const markEdited = () => setState((current) => (current.notice === null ? current : { ...current, notice: null }));

  return { ...state, isPending, save, markEdited };
}

type FormStatusProps = {
  state: Pick<CycleSave, "banner" | "notice" | "isPending">;
  /** Shown while a save runs. */
  pendingText?: string;
};

/** The line under a form: "Zapisano." / "Bez zmian." for screen readers and eyes, or the error. */
export function FormStatus({ state, pendingText }: FormStatusProps) {
  const t = useTranslations("admin.cycles");
  if (state.banner) {
    return (
      <p role="alert" className="rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-danger">
        {t(`errors.${state.banner}`)}
      </p>
    );
  }
  const text = state.isPending ? (pendingText ?? t("saving")) : state.notice ? t(state.notice) : "";
  return (
    <p role="status" className="min-h-5 text-sm font-semibold text-ink-soft">
      {text}
    </p>
  );
}

/** Translated error of one field, or null. */
export function useFieldError(fieldErrors: CycleConfigFieldErrors): (field: string) => string | null {
  const t = useTranslations("admin.cycles");
  return (field) => {
    const code = fieldErrors[field];
    return code ? t(`errors.${code}`) : null;
  };
}

/** "" -> null (the schema reports REQUIRED); anything else -> a number (NaN fails the schema). */
export const toNumberOrNull = (value: string): number | null => (value.trim() === "" ? null : Number(value));
