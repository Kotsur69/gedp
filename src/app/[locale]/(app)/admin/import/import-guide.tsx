import { getTranslations } from "next-intl/server";
import {
  BOOLEAN_FALSE,
  BOOLEAN_TRUE,
  STRUCTURE_COLUMNS,
  STRUCTURE_FIELDS,
  type StructureField,
} from "@/server/import/structure-columns";
import { MAX_IMPORT_ROWS } from "@/server/import/table";

// "How to prepare the file" on the HR import screen (PL/EN from the glossary). The column table is
// generated from STRUCTURE_COLUMNS, so the instruction always matches what the importer accepts.

/** One synthetic example row (fictional person), in column order. */
const EXAMPLE: Readonly<Record<StructureField, string>> = {
  amei: "AM0012345",
  email: "anna.nowak@example.com",
  firstName: "Anna",
  lastName: "Nowak",
  managerAmei: "AM0010001",
  department: "Finanse",
  position: "Analityk",
  location: "Oddział A",
  isWhiteCollar: BOOLEAN_TRUE,
  isActive: BOOLEAN_TRUE,
  hireDate: "2019-03-01",
  isHrAdmin: BOOLEAN_FALSE,
};

const RULE_KEYS = ["format", "header", "rows", "self", "booleans", "dates", "optional"] as const;

const CELL = "border-b border-line px-3 py-2 align-top";
const HEAD = `${CELL} text-left font-semibold text-ink`;

export async function ImportGuide() {
  const t = await getTranslations("admin.import.guide");
  const requiredLabel = (field: StructureField) => {
    const { columnRequired, valueRequired } = STRUCTURE_COLUMNS[field];
    if (!columnRequired) return t("optional");
    return valueRequired ? t("required") : t("requiredColumnOnly");
  };

  return (
    <details className="mt-6 rounded-2xl border border-line bg-canvas p-5">
      <summary className="cursor-pointer font-semibold text-ink">{t("title")}</summary>
      <p className="mt-3 text-ink">{t("intro")}</p>

      <h3 className="mt-5 font-semibold text-ink">{t("rulesTitle")}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-ink">
        {RULE_KEYS.map((key) => (
          <li key={key}>{t(`rules.${key}`, { maxRows: MAX_IMPORT_ROWS })}</li>
        ))}
      </ul>

      <h3 className="mt-5 font-semibold text-ink">{t("columnsTitle")}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th scope="col" className={HEAD}>{t("columnHeader")}</th>
              <th scope="col" className={HEAD}>{t("requiredHeader")}</th>
              <th scope="col" className={HEAD}>{t("descriptionHeader")}</th>
            </tr>
          </thead>
          <tbody>
            {STRUCTURE_FIELDS.map((field) => (
              <tr key={field}>
                <td className={CELL}>
                  <code className="font-semibold">{STRUCTURE_COLUMNS[field].header}</code>
                </td>
                <td className={CELL}>{requiredLabel(field)}</td>
                <td className={CELL}>{t(`fields.${field}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-5 font-semibold text-ink">{t("exampleTitle")}</h3>
      <div className="mt-2 overflow-x-auto">
        <table className="border-collapse text-sm whitespace-nowrap">
          <thead>
            <tr>
              {STRUCTURE_FIELDS.map((field) => (
                <th key={field} scope="col" className={HEAD}>
                  <code>{STRUCTURE_COLUMNS[field].header}</code>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {STRUCTURE_FIELDS.map((field) => (
                <td key={field} className={CELL}>{EXAMPLE[field]}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-sm text-ink-soft">{t("formatNote")}</p>
    </details>
  );
}
