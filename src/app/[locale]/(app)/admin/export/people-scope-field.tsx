"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { CloseIcon } from "@/components/shell/icons";
import { MAX_SELECTED_PEOPLE, PEOPLE_SCOPE_KINDS, splitAmeis, type PeopleScopeKind } from "@/domain/data-export";
import { AMEI_PATTERN } from "@/server/import/structure-columns";
import { CONTROL, LABEL, SECONDARY_BUTTON } from "./form-styles";

// WHO of the export (HR-12): one person, selected people, a department or everyone. People are
// picked by AMEI, with the active employees suggested in a datalist; pasting "AM1, AM2 AM3" adds
// several at once. Malformed AMEIs stay in the input with a message, and nothing is ever dropped
// silently; the server checks every AMEI again and names the ones that match nobody.

export const PEOPLE_OPTIONS_ID = "export-people-options";

export interface PeopleScopeState {
  kind: PeopleScopeKind;
  amei: string;
  ameis: string[];
  department: string;
}

interface PeopleScopeFieldProps {
  value: PeopleScopeState;
  onChange: (next: PeopleScopeState) => void;
  departments: readonly string[];
  /** AMEI -> "First Last", to label the chips. */
  names: ReadonlyMap<string, string>;
  disabled: boolean;
}

export function PeopleScopeField({ value, onChange, departments, names, disabled }: PeopleScopeFieldProps) {
  const t = useTranslations("admin.export");
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  const addDraft = () => {
    const tokens = splitAmeis(draft);
    if (tokens.length === 0) return;
    const invalid = tokens.filter((amei) => !AMEI_PATTERN.test(amei));
    const ameis = [...new Set([...value.ameis, ...tokens.filter((amei) => AMEI_PATTERN.test(amei))])];
    if (ameis.length > MAX_SELECTED_PEOPLE) return setDraftError(t("tooManyPeople", { max: MAX_SELECTED_PEOPLE }));
    onChange({ ...value, ameis });
    setDraft(invalid.join(" "));
    setDraftError(invalid.length > 0 ? t("invalidAmei", { ameis: invalid.join(", ") }) : null);
  };
  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    addDraft();
  };
  const remove = (amei: string) => onChange({ ...value, ameis: value.ameis.filter((item) => item !== amei) });
  const oneInvalid = value.amei !== "" && !AMEI_PATTERN.test(value.amei);
  const oneHint = oneInvalid ? t("invalidAmei", { ameis: value.amei }) : (names.get(value.amei) ?? t("ameiHint"));

  return (
    <fieldset className="rounded-2xl border border-line bg-surface p-4 sm:p-5" disabled={disabled}>
      <legend className="px-1 text-base font-semibold text-ink">{t("whichEmployees")}</legend>
      <div role="radiogroup" aria-label={t("whichEmployees")} className="mt-1 grid gap-2 sm:grid-cols-4">
        {PEOPLE_SCOPE_KINDS.map((kind) => (
          <label
            key={kind}
            className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong px-3 py-2 transition duration-200 hover:border-accent has-checked:border-accent has-checked:bg-canvas has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent/40 motion-reduce:transition-none"
          >
            <input
              type="radio"
              name="people-kind"
              value={kind}
              checked={value.kind === kind}
              onChange={() => onChange({ ...value, kind })}
              className="size-4 accent-(--color-accent)"
            />
            <span className="font-semibold text-ink">{t(`peopleKinds.${kind}`)}</span>
          </label>
        ))}
      </div>

      {value.kind === "one" && (
        <div className="mt-4 max-w-sm">
          <label htmlFor="export-one-amei" className={LABEL}>
            {t("ameiLabel")}
          </label>
          <input
            id="export-one-amei"
            value={value.amei}
            onChange={(event) => onChange({ ...value, amei: event.target.value.trim().toUpperCase() })}
            list={PEOPLE_OPTIONS_ID}
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="export-amei-hint"
            aria-invalid={oneInvalid}
            className={`${CONTROL} uppercase`}
          />
          <p id="export-amei-hint" className={`mt-1 text-sm ${oneInvalid ? "font-semibold text-danger" : "text-ink-soft"}`}>
            {oneHint}
          </p>
        </div>
      )}

      {value.kind === "selected" && (
        <div className="mt-4">
          <label htmlFor="export-add-amei" className={LABEL}>
            {t("addPeopleLabel")}
          </label>
          <div className="mt-1 flex max-w-xl flex-col gap-2 sm:flex-row">
            <input
              id="export-add-amei"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftError(null);
              }}
              onKeyDown={onDraftKey}
              list={PEOPLE_OPTIONS_ID}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={draftError ? "export-add-error export-add-hint" : "export-add-hint"}
              aria-invalid={draftError !== null}
              className={`${CONTROL} mt-0 uppercase`}
            />
            <button type="button" onClick={addDraft} className={SECONDARY_BUTTON}>
              {t("addPeople")}
            </button>
          </div>
          {draftError && (
            <p id="export-add-error" role="alert" className="mt-1 text-sm font-semibold text-danger">
              {draftError}
            </p>
          )}
          <p id="export-add-hint" className="mt-1 text-sm text-ink-soft">
            {t("addPeopleHint", { max: MAX_SELECTED_PEOPLE })}
          </p>
          <p className="mt-3 text-sm font-semibold text-ink tabular-nums" aria-live="polite">
            {t("selectedCount", { count: value.ameis.length })}
          </p>
          {value.ameis.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {value.ameis.map((amei) => (
                <li
                  key={amei}
                  className="flex items-center gap-1 rounded-full border border-line-strong bg-canvas py-1 pr-1 pl-3 text-sm text-ink"
                >
                  <span>
                    {names.get(amei) ? `${names.get(amei)} · ` : ""}
                    <span className="font-semibold">{amei}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(amei)}
                    aria-label={t("removePerson", { amei })}
                    className="grid size-8 cursor-pointer place-items-center rounded-full text-ink-soft hover:bg-surface hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent"
                  >
                    <CloseIcon className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {value.kind === "department" && (
        <div className="mt-4 max-w-sm">
          <label htmlFor="export-department" className={LABEL}>
            {t("department")}
          </label>
          <select
            id="export-department"
            value={value.department}
            onChange={(event) => onChange({ ...value, department: event.target.value })}
            className={CONTROL}
          >
            <option value="">{t("chooseDepartment")}</option>
            {departments.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.kind === "all" && <p className="mt-4 text-sm text-ink-soft">{t("everyoneHint")}</p>}
    </fieldset>
  );
}
