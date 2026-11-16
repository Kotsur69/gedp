"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { PreviewIssue, PreviewRow } from "./preview-view";

// Presentational tables of the import preview: new / changed / deactivated people and row errors.
// Plain on purpose; the design pass comes with the app shell.

/** Issue codes the glossary translates (StructureIssueCode); anything else shows as UNKNOWN. */
const ISSUE_CODES = [
  "MISSING_COLUMN",
  "DUPLICATE_COLUMN",
  "NO_ROWS",
  "SELF_LOCKOUT",
  "REQUIRED",
  "TOO_LONG",
  "INVALID_TEXT",
  "INVALID_AMEI",
  "INVALID_EMAIL",
  "INVALID_BOOLEAN",
  "INVALID_DATE",
  "DUPLICATE_AMEI",
  "DUPLICATE_EMAIL",
  "UNKNOWN_MANAGER",
  "MANAGER_REJECTED",
  "HIERARCHY_CYCLE",
] as const;
type IssueCode = (typeof ISSUE_CODES)[number] | "UNKNOWN";

const isIssueCode = (code: string): code is IssueCode => (ISSUE_CODES as readonly string[]).includes(code);

/** Structure record field -> glossary key under admin.employeeFields. */
const FIELD_LABEL_KEYS = {
  amei: "amei",
  email: "email",
  firstName: "firstName",
  lastName: "lastName",
  managerAmei: "manager",
  department: "department",
  position: "position",
  location: "location",
  isWhiteCollar: "whiteCollar",
  isActive: "active",
  hireDate: "hireDate",
  isHrAdmin: "hrAdmin",
} as const;
type FieldName = keyof typeof FIELD_LABEL_KEYS;

const isFieldName = (field: string): field is FieldName => Object.hasOwn(FIELD_LABEL_KEYS, field);

const CELL = "border-b border-line px-3 py-2 align-top";
const HEAD = `${CELL} text-left font-semibold text-ink`;

function useValueFormatter() {
  const tFields = useTranslations("admin.employeeFields");
  const tCommon = useTranslations("common");
  const label = (field: string) => (isFieldName(field) ? tFields(FIELD_LABEL_KEYS[field]) : field);
  const value = (raw: string) => {
    if (raw === "true") return tCommon("yes");
    if (raw === "false") return tCommon("no");
    return raw === "" ? "—" : raw;
  };
  return { label, value };
}

type TableShellProps = { title: string; total: number; shown: number; children: ReactNode };

function TableShell({ title, total, shown, children }: TableShellProps) {
  const t = useTranslations("admin.import");
  return (
    <section className="mt-8">
      <h3 className="text-lg font-semibold text-ink">{title}</h3>
      {total === 0 ? (
        <p className="mt-2 text-ink-soft">{t("none")}</p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">{children}</table>
          </div>
          {shown < total && <p className="mt-2 text-sm text-ink-soft">{t("shownOf", { shown, total })}</p>}
        </>
      )}
    </section>
  );
}

type ChangeTableProps = { title: string; rows: readonly PreviewRow[]; total: number; showChanges: boolean };

export function ChangeTable({ title, rows, total, showChanges }: ChangeTableProps) {
  const t = useTranslations("admin.import");
  const format = useValueFormatter();
  return (
    <TableShell title={title} total={total} shown={rows.length}>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>{t("rowHeader")}</th>
          <th scope="col" className={HEAD}>AMEI</th>
          <th scope="col" className={HEAD}>{t("employee")}</th>
          {showChanges && <th scope="col" className={HEAD}>{t("changes")}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            <td className={CELL}>{row.line ?? "—"}</td>
            <td className={CELL}>{row.key}</td>
            <td className={CELL}>{row.name}</td>
            {showChanges && (
              <td className={CELL}>
                <ul>
                  {row.fields.map((f) => (
                    <li key={f.field}>
                      {format.label(f.field)}: {format.value(f.before)} → {format.value(f.after)}
                    </li>
                  ))}
                </ul>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}

type ErrorTableProps = { title: string; issues: readonly PreviewIssue[]; total: number };

export function ErrorTable({ title, issues, total }: ErrorTableProps) {
  const t = useTranslations("admin.import");
  const reason = (issue: PreviewIssue) => t(`issue.${isIssueCode(issue.code) ? issue.code : "UNKNOWN"}`);
  return (
    <TableShell title={title} total={total} shown={issues.length}>
      <thead>
        <tr>
          <th scope="col" className={HEAD}>{t("rowHeader")}</th>
          <th scope="col" className={HEAD}>{t("column")}</th>
          <th scope="col" className={HEAD}>{t("reason")}</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue, index) => (
          // Issues have no id and one row may have several, so line + position keeps keys unique.
          <tr key={`${issue.line}-${index}`}>
            <td className={CELL}>{issue.line ?? "—"}</td>
            <td className={CELL}>{issue.column ?? "—"}</td>
            <td className={CELL}>
              {reason(issue)}
              {issue.people && issue.people.length > 0 && (
                <span className="block text-ink-soft">{t("people", { people: issue.people.join(" → ") })}</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableShell>
  );
}
