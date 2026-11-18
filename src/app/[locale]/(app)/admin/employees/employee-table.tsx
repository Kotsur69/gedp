"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, InfoIcon, PencilIcon } from "@/components/shell/icons";
import type { EmployeeListItem } from "@/server/employee-admin";
import { EmployeeEditDialog, type SaveOutcome } from "./employee-edit-dialog";

// Employee list of the HR panel (HR-04): one row per person, "Edytuj" opens the edit window.
// Display only: the page loads the rows (HR checked there) and the Server Action re-checks on save.

const CELL = "border-b border-line px-3 py-3 align-top";
const HEAD =
  "border-b border-line-strong px-3 py-2 text-left text-xs font-semibold tracking-[0.06em] text-ink-soft uppercase";

type EmployeeTableProps = { items: readonly EmployeeListItem[] };

export function EmployeeTable({ items }: EmployeeTableProps) {
  const t = useTranslations("admin");
  const [editedId, setEditedId] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const edited = items.find((item) => item.id === editedId) ?? null;

  const handleSaved = (outcome: SaveOutcome) => {
    setStatus(t(outcome.changed ? "employees.edit.saved" : "employees.edit.unchanged", { name: outcome.name }));
  };

  // Always mounted (also for an empty list), so a "saved" message that empties the filtered list is
  // still announced: screen readers only read changes to a live region that already exists.
  const statusRegion = (
    <p role="status" aria-live="polite" className="mt-2 min-h-6 text-sm font-semibold text-accent">
      {status}
    </p>
  );

  if (items.length === 0) {
    return (
      <>
        {statusRegion}
        <p className="mt-2 rounded-2xl border border-dashed border-line-strong p-6 text-ink-soft">
          {t("employees.empty")}
        </p>
      </>
    );
  }

  return (
    <>
      {statusRegion}
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">{t("employees.tableCaption")}</caption>
          <thead>
            <tr>
              <th scope="col" className={HEAD}>
                {t("employees.name")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.amei")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.department")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.manager")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.active")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.whiteCollar")}
              </th>
              <th scope="col" className={HEAD}>
                {t("employeeFields.hrAdmin")}
              </th>
              <th scope="col" className={HEAD}>
                <span className="sr-only">{t("employees.actions")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <EmployeeRow
                key={item.id}
                item={item}
                onEdit={() => {
                  setStatus(null);
                  setEditedId(item.id);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
      <EmployeeEditDialog employee={edited} onClosed={() => setEditedId(null)} onSaved={handleSaved} />
    </>
  );
}

type EmployeeRowProps = { item: EmployeeListItem; onEdit: () => void };

function EmployeeRow({ item, onEdit }: EmployeeRowProps) {
  const t = useTranslations("admin");
  const tCommon = useTranslations("common");
  const name = `${item.firstName} ${item.lastName}`;
  return (
    <tr className="transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none">
      <th scope="row" className={`${CELL} text-left font-normal`}>
        <span className={`block font-semibold ${item.isActive ? "text-ink" : "text-ink-soft"}`}>{name}</span>
        <span className="block break-all text-ink-soft">{item.email}</span>
      </th>
      <td className={`${CELL} font-semibold text-ink tabular-nums`}>{item.amei}</td>
      <td className={`${CELL} text-ink`}>
        <span className="block">{item.department ?? "—"}</span>
        {item.position && <span className="block text-ink-soft">{item.position}</span>}
      </td>
      <td className={`${CELL} text-ink`}>
        {item.managerAmei ? (
          <>
            <span className="block">{item.managerName}</span>
            <span className="block text-ink-soft tabular-nums">{item.managerAmei}</span>
          </>
        ) : (
          <span className="block text-ink-soft">{t("employees.topOfStructure")}</span>
        )}
        <ValidatorOverride item={item} />
      </td>
      <td className={CELL}>
        <YesNo value={item.isActive} />
      </td>
      <td className={CELL}>
        <YesNo value={item.isWhiteCollar} />
      </td>
      <td className={CELL}>
        <YesNo value={item.isHrAdmin} />
      </td>
      <td className={`${CELL} text-right`}>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t("employees.editPerson", { name })}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line-strong bg-surface px-4 font-semibold text-ink transition duration-200 hover:border-accent hover:text-accent focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none"
        >
          <PencilIcon />
          {tCommon("edit")}
        </button>
      </td>
    </tr>
  );
}

/**
 * WF-09 override validator under the manager. Someone with neither a manager nor an override has
 * nobody to validate their document: say so in text (the notice tone only reinforces it).
 */
function ValidatorOverride({ item }: { item: EmployeeListItem }) {
  const t = useTranslations("admin");
  if (item.validatorOverrideAmei) {
    return (
      <span className="mt-1.5 block border-l-2 border-accent/50 pl-2">
        <span className="block text-xs font-semibold tracking-[0.04em] text-accent">{t("employees.overrideLabel")}</span>
        <span className="block">{item.validatorOverrideName}</span>
        <span className="block text-ink-soft tabular-nums">{item.validatorOverrideAmei}</span>
      </span>
    );
  }
  if (item.managerAmei || !item.isActive) return null;
  return (
    <span className="mt-1.5 inline-flex items-start gap-1 rounded-lg bg-notice-surface px-2 py-1 text-xs font-semibold text-notice">
      <InfoIcon className="mt-px size-3.5 shrink-0" />
      {t("employees.noValidator")}
    </span>
  );
}

/** Yes is marked with an icon AND text, so the meaning never rests on colour alone. */
function YesNo({ value }: { value: boolean }) {
  const t = useTranslations("common");
  return value ? (
    <span className="inline-flex items-center gap-1 font-semibold text-ink">
      <CheckIcon className="size-4 text-accent" />
      {t("yes")}
    </span>
  ) : (
    <span className="text-ink-soft">{t("no")}</span>
  );
}
