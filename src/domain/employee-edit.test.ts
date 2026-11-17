import { describe, expect, it } from "vitest";
import {
  employeeChanges,
  employeeEditFieldErrors,
  employeeEditSchema,
  type EditableEmployee,
  type EmployeeEditPayload,
} from "./employee-edit";

const payload = (overrides: Partial<EmployeeEditPayload> = {}): EmployeeEditPayload => ({
  employeeId: 7,
  version: "2026-11-17T10:00:00.000Z",
  managerAmei: " ab12345 ",
  department: "  Sprzedaż ",
  position: "",
  location: "Oddział A",
  isActive: true,
  isHrAdmin: false,
  ...overrides,
});

describe("[HR-04] employeeEditSchema", () => {
  it("trims, upper-cases the manager AMEI and turns empty text into null", () => {
    const parsed = employeeEditSchema.parse(payload());
    expect(parsed).toMatchObject({ managerAmei: "AB12345", department: "Sprzedaż", position: null });
  });

  it("treats an empty manager as the top of the structure", () => {
    expect(employeeEditSchema.parse(payload({ managerAmei: "  " })).managerAmei).toBeNull();
  });

  it("maps field problems to codes under the right field", () => {
    const result = employeeEditSchema.safeParse(
      payload({ managerAmei: "a-b", department: "x".repeat(201), location: "line\nbreak" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(employeeEditFieldErrors(result.error)).toEqual({
      managerAmei: "INVALID_AMEI",
      department: "TEXT_TOO_LONG",
      location: "INVALID_TEXT",
    });
  });

  it("rejects unknown keys, a bad id and a missing version (never trusted from the browser)", () => {
    expect(employeeEditSchema.safeParse({ ...payload(), isWhiteCollar: false }).success).toBe(false);
    expect(employeeEditSchema.safeParse(payload({ employeeId: 0 })).success).toBe(false);
    expect(employeeEditSchema.safeParse(payload({ employeeId: 2 ** 31 })).success).toBe(false);
    expect(employeeEditSchema.safeParse(payload({ version: "yesterday" })).success).toBe(false);
  });

  it("rejects invisible bidi characters", () => {
    expect(employeeEditSchema.safeParse(payload({ position: "Kier‮ownik" })).success).toBe(false);
  });
});

describe("[HR-04] employeeChanges", () => {
  const base: EditableEmployee = {
    managerAmei: "AB1",
    department: "IT",
    position: null,
    location: null,
    isActive: true,
    isHrAdmin: false,
  };

  it("is empty when nothing changed", () => {
    expect(employeeChanges(base, { ...base })).toEqual([]);
  });

  it("lists changed fields in form order with before and after", () => {
    expect(employeeChanges(base, { ...base, isHrAdmin: true, managerAmei: null })).toEqual([
      { field: "managerAmei", before: "AB1", after: null },
      { field: "isHrAdmin", before: false, after: true },
    ]);
  });
});
