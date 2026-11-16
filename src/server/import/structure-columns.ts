// Column map of the employee-structure import file (HR-01).
// The format is PROPOSED, not confirmed by HR (Q-10, "Historia wersji oraz md/Wymagania/
// 07_Panel_HR_raporty_statystyki.md"); `hr_admin` is our own assumption. When HR delivers the real
// export, change the headers and literals here - the importer only uses the field names.

export type StructureField =
  | "amei"
  | "email"
  | "firstName"
  | "lastName"
  | "managerAmei"
  | "department"
  | "position"
  | "location"
  | "isWhiteCollar"
  | "isActive"
  | "hireDate"
  | "isHrAdmin";

export type StructureValueKind = "amei" | "email" | "text" | "boolean" | "date";

export interface StructureColumn {
  /** Header in the file; matched trimmed and case-insensitively. */
  header: string;
  kind: StructureValueKind;
  /** The column must exist in the file. An absent optional column leaves the field unchanged. */
  columnRequired: boolean;
  /** Every row must have a value. An empty optional cell clears the field (booleans: NIE). */
  valueRequired: boolean;
}

export const STRUCTURE_COLUMNS: Readonly<Record<StructureField, StructureColumn>> = {
  amei: { header: "amei", kind: "amei", columnRequired: true, valueRequired: true },
  email: { header: "email", kind: "email", columnRequired: true, valueRequired: true },
  firstName: { header: "imie", kind: "text", columnRequired: true, valueRequired: true },
  lastName: { header: "nazwisko", kind: "text", columnRequired: true, valueRequired: true },
  // Empty = top of the structure.
  managerAmei: { header: "amei_przelozonego", kind: "amei", columnRequired: true, valueRequired: false },
  department: { header: "dzial", kind: "text", columnRequired: false, valueRequired: false },
  position: { header: "stanowisko", kind: "text", columnRequired: false, valueRequired: false },
  location: { header: "lokalizacja", kind: "text", columnRequired: false, valueRequired: false },
  isWhiteCollar: { header: "white_collar", kind: "boolean", columnRequired: true, valueRequired: true },
  isActive: { header: "aktywny", kind: "boolean", columnRequired: true, valueRequired: true },
  hireDate: { header: "data_zatrudnienia", kind: "date", columnRequired: false, valueRequired: false },
  isHrAdmin: { header: "hr_admin", kind: "boolean", columnRequired: false, valueRequired: false },
};

export const STRUCTURE_FIELDS = Object.keys(STRUCTURE_COLUMNS) as StructureField[];

/** Boolean literals, matched case-insensitively. */
export const BOOLEAN_TRUE = "TAK";
export const BOOLEAN_FALSE = "NIE";

/** AMEI is stored upper-cased. Real format unknown (Q-10), so only the character set is checked. */
export const AMEI_PATTERN = /^[A-Z0-9]{3,20}$/;
export const MAX_TEXT_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 254;
