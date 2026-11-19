"use client";

import { useEffect, useRef, useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  EMPLOYEE_EDIT_FIELDS,
  employeeEditFieldErrors,
  employeeEditSchema,
  type EmployeeEditField,
  type EmployeeEditFieldErrors,
  type EmployeeEditPayload,
} from "@/domain/employee-edit";
import type { EmployeeListItem } from "@/server/employee-admin";
import { MAX_TEXT_LENGTH } from "@/server/import/structure-columns";
import { updateEmployeeAction, type EmployeeEditActionErrorCode } from "./actions";
import { DEPARTMENT_OPTIONS_ID, MANAGER_OPTIONS_ID } from "./option-lists";

// HR-04 edit window: manager, WF-09 override validator, department, position, location, active, HR admin. Identity fields are
// shown read-only (the structure import owns them). The form runs the shared zod schema for quick
// feedback; the server validates again, rejects a manager loop and audits the change.

export type SaveOutcome = { name: string; changed: boolean };

const TITLE_ID = "employee-edit-title";
const ERROR_ID = "employee-edit-error";
const MAX_AMEI_LENGTH = 20;

type EmployeeEditDialogProps = {
  employee: EmployeeListItem | null;
  onClosed: () => void;
  onSaved: (outcome: SaveOutcome) => void;
};

export function EmployeeEditDialog({ employee, onClosed, onSaved }: EmployeeEditDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pendingRef = useRef(false);

  // Syncs the native <dialog> (an external DOM API) with the person chosen in the table.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (employee && !dialog.open) dialog.showModal();
    if (!employee && dialog.open) dialog.close();
  }, [employee]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={TITLE_ID}
      // Escape must not close the window while a save is running: its result would be lost.
      onCancel={(event) => pendingRef.current && event.preventDefault()}
      // Browsers may close a modal on a repeated Escape without a cancelable event: reopen it.
      onClose={() => (pendingRef.current && employee ? dialogRef.current?.showModal() : onClosed())}
      className="m-auto max-h-[92dvh] w-[min(100%-2rem,40rem)] overflow-hidden rounded-3xl border border-line bg-surface p-0 text-ink shadow-card backdrop:bg-scrim backdrop:backdrop-blur-sm"
    >
      {employee && (
        <EditForm
          key={employee.id}
          employee={employee}
          pendingRef={pendingRef}
          requestClose={() => dialogRef.current?.close()}
          onSaved={onSaved}
        />
      )}
    </dialog>
  );
}

type FormValues = Omit<EmployeeEditPayload, "employeeId" | "version">;

const toFormValues = (employee: EmployeeListItem): FormValues => ({
  managerAmei: employee.managerAmei ?? "",
  validatorOverrideAmei: employee.validatorOverrideAmei ?? "",
  department: employee.department ?? "",
  position: employee.position ?? "",
  location: employee.location ?? "",
  isActive: employee.isActive,
  isHrAdmin: employee.isHrAdmin,
});

const fieldId = (field: EmployeeEditField) => `employee-edit-${field}`;

type EditFormProps = {
  employee: EmployeeListItem;
  pendingRef: { current: boolean };
  requestClose: () => void;
  onSaved: (outcome: SaveOutcome) => void;
};

function EditForm({ employee, pendingRef, requestClose, onSaved }: EditFormProps) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const [values, setValues] = useState<FormValues>(() => toFormValues(employee));
  // The version the form was filled from. NOT the live prop: after a STALE answer the page refreshes
  // and the prop carries the newer version, which would let a second "Zapisz" overwrite that change.
  // Only "Wczytaj aktualne dane" moves it forward, together with the values HR then sees.
  const [version, setVersion] = useState(employee.version);
  const [fieldErrors, setFieldErrors] = useState<EmployeeEditFieldErrors>({});
  const [formError, setFormError] = useState<EmployeeEditActionErrorCode | null>(null);
  const [isPending, startTransition] = useTransition();
  // Element to focus once nothing is pending (inputs are read-only while a save runs).
  const focusRequestRef = useRef<string | null>(null);
  const name = `${employee.firstName} ${employee.lastName}`;

  useEffect(() => {
    pendingRef.current = isPending;
    if (isPending || !focusRequestRef.current) return;
    document.getElementById(focusRequestRef.current)?.focus();
    focusRequestRef.current = null;
  });

  const showErrors = (errors: EmployeeEditFieldErrors, banner: EmployeeEditActionErrorCode | null) => {
    setFieldErrors(errors);
    setFormError(banner);
    const first = EMPLOYEE_EDIT_FIELDS.find((field) => errors[field] !== undefined);
    focusRequestRef.current = first ? fieldId(first) : banner ? ERROR_ID : null;
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;
    const payload: EmployeeEditPayload = { employeeId: employee.id, version, ...values };
    const parsed = employeeEditSchema.safeParse(payload);
    if (!parsed.success) return showErrors(employeeEditFieldErrors(parsed.error), null);
    showErrors({}, null);
    startTransition(async () => {
      try {
        const result = await updateEmployeeAction(payload);
        if (!result.ok) {
          const hasFieldError = Object.keys(result.fieldErrors).length > 0;
          return showErrors(result.fieldErrors, hasFieldError ? null : result.code);
        }
        onSaved({ name, changed: result.changed });
        requestClose();
      } catch {
        // Network failure or a server error outside the action's own handling.
        showErrors({}, "FAILED");
      }
    });
  };

  const handleReload = () => {
    setValues(toFormValues(employee));
    setVersion(employee.version);
    showErrors({}, null);
    focusRequestRef.current = fieldId(EMPLOYEE_EDIT_FIELDS[0]);
  };

  const set = <K extends keyof FormValues>(field: K, value: FormValues[K]) =>
    setValues((current) => ({ ...current, [field]: value }));

  const fieldProps = (field: EmployeeEditField) => {
    const code = fieldErrors[field];
    return { id: fieldId(field), error: code ? t(`employees.errors.${code}`) : null };
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="flex max-h-[92dvh] flex-col">
      <header className="border-b border-line px-6 pt-6 pb-4 sm:px-8">
        <p className="text-sm font-semibold text-accent">{t("employees.edit.title")}</p>
        <h2 id={TITLE_ID} className="mt-1 text-xl font-semibold text-balance sm:text-2xl">
          {name}
        </h2>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <ReadOnly label={t("employeeFields.amei")} value={employee.amei} />
          <ReadOnly label={t("employeeFields.email")} value={employee.email} />
          <ReadOnly label={t("employeeFields.whiteCollar")} value={tCommon(employee.isWhiteCollar ? "yes" : "no")} />
        </dl>
        <p className="mt-2 text-sm text-ink-soft">{t("employees.edit.identityHint")}</p>
      </header>

      <div className="grid gap-5 overflow-y-auto px-6 py-5 sm:grid-cols-2 sm:px-8">
        <TextField
          {...fieldProps("managerAmei")}
          label={t("employeeFields.manager")}
          hint={t("employees.edit.managerHint")}
          value={values.managerAmei}
          onChange={(value) => set("managerAmei", value)}
          list={MANAGER_OPTIONS_ID}
          maxLength={MAX_AMEI_LENGTH}
          isReadOnly={isPending}
          className="sm:col-span-2 [&_input]:uppercase"
        />
        <TextField
          {...fieldProps("validatorOverrideAmei")}
          label={t("employeeFields.validatorOverride")}
          hint={t("employees.edit.validatorOverrideHint")}
          value={values.validatorOverrideAmei}
          onChange={(value) => set("validatorOverrideAmei", value)}
          list={MANAGER_OPTIONS_ID}
          maxLength={MAX_AMEI_LENGTH}
          isReadOnly={isPending}
          className="sm:col-span-2 [&_input]:uppercase"
        />
        <TextField
          {...fieldProps("department")}
          label={t("employeeFields.department")}
          value={values.department}
          onChange={(value) => set("department", value)}
          list={DEPARTMENT_OPTIONS_ID}
          isReadOnly={isPending}
        />
        <TextField
          {...fieldProps("position")}
          label={t("employeeFields.position")}
          value={values.position}
          onChange={(value) => set("position", value)}
          isReadOnly={isPending}
        />
        <TextField
          {...fieldProps("location")}
          label={t("employeeFields.location")}
          value={values.location}
          onChange={(value) => set("location", value)}
          isReadOnly={isPending}
          className="sm:col-span-2"
        />
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-semibold text-ink">{t("employees.edit.flags")}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <CheckField
              {...fieldProps("isActive")}
              label={t("employeeFields.active")}
              checked={values.isActive}
              onChange={(checked) => set("isActive", checked)}
              isBusy={isPending}
            />
            <CheckField
              {...fieldProps("isHrAdmin")}
              label={t("employeeFields.hrAdmin")}
              checked={values.isHrAdmin}
              onChange={(checked) => set("isHrAdmin", checked)}
              isBusy={isPending}
            />
          </div>
        </fieldset>
        {formError && (
          <div className="rounded-xl bg-notice-surface px-4 py-3 sm:col-span-2">
            <p id={ERROR_ID} role="alert" tabIndex={-1} className="text-sm font-semibold text-danger focus:outline-none">
              {t(`employees.errors.${formError}`)}
            </p>
            {formError === "STALE" && (
              <button
                type="button"
                onClick={handleReload}
                className="mt-2 min-h-11 cursor-pointer rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
              >
                {t("employees.edit.reload")}
              </button>
            )}
          </div>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-line px-6 py-4 sm:px-8">
        <p className="mr-auto text-sm text-ink-soft">{t("employees.edit.auditNote")}</p>
        <button
          type="button"
          onClick={() => !isPending && requestClose()}
          aria-disabled={isPending || undefined}
          className="min-h-11 cursor-pointer rounded-xl border border-line-strong bg-surface px-5 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none"
        >
          {tCommon("cancel")}
        </button>
        <button
          type="submit"
          aria-disabled={isPending || undefined}
          aria-busy={isPending || undefined}
          className="min-h-11 cursor-pointer rounded-xl bg-(image:--am-gradient) px-5 font-semibold tracking-[0.04em] text-on-brand transition duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent aria-disabled:cursor-wait aria-disabled:opacity-60 motion-reduce:transition-none"
        >
          {isPending ? t("employees.edit.saving") : tCommon("save")}
        </button>
      </footer>
    </form>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1">
      <dt className="text-ink-soft">{label}:</dt>
      <dd className="font-semibold break-all">{value}</dd>
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-sm font-semibold text-danger">
      {children}
    </p>
  );
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  isReadOnly: boolean;
  hint?: string;
  list?: string;
  maxLength?: number;
  className?: string;
};

function TextField({ id, label, value, onChange, error, isReadOnly, hint, list, maxLength, className }: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        readOnly={isReadOnly}
        list={list}
        // One over the limit, so the schema can say "too long" instead of the browser cutting silently.
        maxLength={(maxLength ?? MAX_TEXT_LENGTH) + 1}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface px-3 text-base text-ink transition duration-200 hover:border-accent read-only:bg-canvas focus-visible:border-accent focus-visible:outline-3 focus-visible:outline-offset-1 focus-visible:outline-accent/40 aria-invalid:border-danger motion-reduce:transition-none"
      />
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-soft">
          {hint}
        </p>
      )}
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}

type CheckFieldProps = {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  error: string | null;
  isBusy: boolean;
};

function CheckField({ id, label, checked, onChange, error, isBusy }: CheckFieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border border-line-strong px-3 transition duration-200 hover:border-accent has-focus-visible:outline-3 has-focus-visible:outline-offset-1 has-focus-visible:outline-accent/40 motion-reduce:transition-none"
      >
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => !isBusy && onChange(event.target.checked)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          className="size-5 accent-(--color-accent)"
        />
        <span className="font-semibold text-ink">{label}</span>
      </label>
      {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
    </div>
  );
}
