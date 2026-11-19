"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { describedControl, GOAL_CONTROL_CLASSES, GoalField } from "@/components/goals/goal-field";
import { CopyIcon } from "@/components/shell/icons";
import { createCycleSchema, cycleConfigFieldErrors, MAX_CYCLE_YEAR, MIN_CYCLE_YEAR } from "@/domain/cycle-config";
import { createCycleAction, type CycleActionErrorCode } from "./actions";
import { PRIMARY_BUTTON, toNumberOrNull } from "./cycle-form-kit";

// "Nowy cykl" (HR-05): year + source cycle. The default is next year as a copy of the newest
// cycle, which is how HR prepares 2027 from 2026 without a developer. After creating, the cycle's
// configuration page opens so HR can adjust the copy.

const EMPTY_SOURCE = "";
const YEAR_ID = "new-cycle-year";
const SOURCE_ID = "new-cycle-source";

type NewCycleFormProps = {
  /** Existing cycles, newest first. */
  cycles: readonly { id: number; year: number }[];
  defaultYear: number;
};

export function NewCycleForm({ cycles, defaultYear }: NewCycleFormProps) {
  const t = useTranslations("admin.cycles");
  const router = useRouter();
  const [year, setYear] = useState(String(defaultYear));
  const [source, setSource] = useState(cycles[0] ? String(cycles[0].id) : EMPTY_SOURCE);
  const [yearError, setYearError] = useState<CycleActionErrorCode | null>(null);
  const [banner, setBanner] = useState<CycleActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    const payload = { year: toNumberOrNull(year), sourceCycleId: source === EMPTY_SOURCE ? null : Number(source) };
    const parsed = createCycleSchema.safeParse(payload);
    setBanner(null);
    if (!parsed.success) {
      setYearError(cycleConfigFieldErrors(parsed.error).year ?? "INVALID_INPUT");
      return;
    }
    setYearError(null);
    startTransition(async () => {
      try {
        const result = await createCycleAction(payload);
        if (result.ok) {
          router.push(`/admin/cycles/${result.year}`);
          return;
        }
        if (result.fieldErrors.year) setYearError(result.fieldErrors.year);
        else setBanner(result.code);
      } catch {
        setBanner("FAILED");
      }
    });
  };

  const yearErrorText = yearError ? t(`errors.${yearError}`) : null;

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-labelledby="new-cycle-title"
      className="mt-5 grid gap-5 md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_auto] md:items-start"
    >
      <GoalField id={YEAR_ID} label={t("new.year")} hint={t("new.yearHint")} error={yearErrorText}>
        <input
          {...describedControl(YEAR_ID, yearError !== null)}
          type="number"
          inputMode="numeric"
          min={MIN_CYCLE_YEAR}
          max={MAX_CYCLE_YEAR}
          value={year}
          onChange={(event) => setYear(event.target.value)}
          readOnly={isPending}
          className={`${GOAL_CONTROL_CLASSES} tabular-nums`}
        />
      </GoalField>
      <GoalField id={SOURCE_ID} label={t("new.source")} hint={t("new.sourceHint")} error={null}>
        <select
          {...describedControl(SOURCE_ID, false)}
          value={source}
          // Stays focusable while creating; a change is simply ignored.
          onChange={(event) => !isPending && setSource(event.target.value)}
          aria-disabled={isPending || undefined}
          className={`${GOAL_CONTROL_CLASSES} cursor-pointer`}
        >
          {cycles.map((cycle) => (
            <option key={cycle.id} value={cycle.id}>
              {t("new.sourceCopy", { year: cycle.year })}
            </option>
          ))}
          <option value={EMPTY_SOURCE}>{t("new.sourceEmpty")}</option>
        </select>
      </GoalField>
      <button
        type="submit"
        aria-disabled={isPending || undefined}
        aria-busy={isPending || undefined}
        className={`${PRIMARY_BUTTON} md:mt-7`}
      >
        <CopyIcon className="size-5" />
        {isPending ? t("new.creating") : t("new.submit")}
      </button>
      {banner && (
        <p role="alert" className="rounded-xl bg-notice-surface px-4 py-3 text-sm font-semibold text-danger md:col-span-3">
          {t(`errors.${banner}`)}
        </p>
      )}
    </form>
  );
}
