import { z } from "zod";
import { AMEI_PATTERN, MAX_TEXT_LENGTH } from "@/server/import/structure-columns";

// HR-04: manual edit of one employee in the HR panel (manager, WF-09 override validator, department,
// position, location, active, HR admin). ONE schema for the form and the server, client-safe (zod only); issue
// messages are error codes the UI translates. Identity fields (AMEI, e-mail, names, White Collar)
// stay owned by the structure import (HR-01) and are not editable here.
//
// `version` is the row's updatedAt as loaded by the form: the server rejects the save (STALE) when
// someone else changed the person in between, instead of silently overwriting their change.

export const EMPLOYEE_EDIT_FIELDS = [
  "managerAmei",
  "validatorOverrideAmei",
  "department",
  "position",
  "location",
  "isActive",
  "isHrAdmin",
] as const;
export type EmployeeEditField = (typeof EMPLOYEE_EDIT_FIELDS)[number];

export const EMPLOYEE_EDIT_ERROR_CODES = [
  "INVALID_INPUT",
  "INVALID_AMEI",
  "TEXT_TOO_LONG",
  "INVALID_TEXT",
  "SELF_MANAGER",
  "UNKNOWN_MANAGER",
  "SELF_VALIDATOR",
  "UNKNOWN_VALIDATOR",
  "INACTIVE_VALIDATOR",
  "HIERARCHY_CYCLE",
  "SELF_LOCKOUT",
  "STALE",
  "NOT_FOUND",
] as const;
export type EmployeeEditErrorCode = (typeof EMPLOYEE_EDIT_ERROR_CODES)[number];

export type EmployeeEditFieldErrors = Partial<Record<EmployeeEditField, EmployeeEditErrorCode>>;

const MAX_INT4 = 2_147_483_647;
// Same rule as the structure import: no line breaks, control or invisible bidi characters.
const HIDDEN_CHARACTERS = /[\p{Cc}​-‏‪-‮⁠-⁩﻿]/u;

const isErrorCode = (value: unknown): value is EmployeeEditErrorCode =>
  typeof value === "string" && (EMPLOYEE_EDIT_ERROR_CODES as readonly string[]).includes(value);

/** Optional free text: trimmed, empty becomes null (clears the field). */
const optionalText = z
  .string("INVALID_INPUT")
  .trim()
  .max(MAX_TEXT_LENGTH, "TEXT_TOO_LONG")
  .refine((value) => !HIDDEN_CHARACTERS.test(value), "INVALID_TEXT")
  .transform((value) => (value === "" ? null : value));

/**
 * AMEI of another person, upper-cased like the import; empty = nobody. Used for the manager (empty =
 * top of the structure) and for the WF-09 override validator (empty = no override).
 */
const personAmei = z
  .string("INVALID_INPUT")
  .trim()
  .toUpperCase()
  .refine((value) => value === "" || AMEI_PATTERN.test(value), "INVALID_AMEI")
  .transform((value) => (value === "" ? null : value));

export const employeeEditSchema = z
  .object({
    employeeId: z.number("INVALID_INPUT").int("INVALID_INPUT").min(1, "INVALID_INPUT").max(MAX_INT4, "INVALID_INPUT"),
    version: z.iso.datetime({ message: "INVALID_INPUT" }),
    managerAmei: personAmei,
    // WF-09: validates this person's documents IN ADDITION to the manager (permissions.ts). Who it
    // should be for the top of the structure is open (Q-05); HR decides case by case.
    validatorOverrideAmei: personAmei,
    department: optionalText,
    position: optionalText,
    location: optionalText,
    isActive: z.boolean("INVALID_INPUT"),
    isHrAdmin: z.boolean("INVALID_INPUT"),
  })
  .strict();

export type EmployeeEditPayload = z.input<typeof employeeEditSchema>;
export type EmployeeEditInput = z.output<typeof employeeEditSchema>;

/** First error code per field, for messages under the inputs. */
export function employeeEditFieldErrors(error: z.ZodError): EmployeeEditFieldErrors {
  const errors: EmployeeEditFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field !== "string" || !(EMPLOYEE_EDIT_FIELDS as readonly string[]).includes(field)) continue;
    const key = field as EmployeeEditField;
    if (errors[key] === undefined) errors[key] = isErrorCode(issue.message) ? issue.message : "INVALID_INPUT";
  }
  return errors;
}

/** The editable values of a person, as compared, audited and shown in the form. */
export interface EditableEmployee {
  managerAmei: string | null;
  validatorOverrideAmei: string | null;
  department: string | null;
  position: string | null;
  location: string | null;
  isActive: boolean;
  isHrAdmin: boolean;
}

export interface EmployeeFieldChange {
  field: EmployeeEditField;
  before: string | boolean | null;
  after: string | boolean | null;
}

/** Fields whose value differs, in form order. Empty when the save changes nothing. */
export function employeeChanges(before: EditableEmployee, after: EditableEmployee): EmployeeFieldChange[] {
  return EMPLOYEE_EDIT_FIELDS.filter((field) => before[field] !== after[field]).map((field) => ({
    field,
    before: before[field],
    after: after[field],
  }));
}
