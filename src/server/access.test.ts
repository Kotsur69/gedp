import { describe, expect, it } from "vitest";
import { decideAccess, parseEmployeeId, type EmployeeAccessRow } from "./access";

describe("parseEmployeeId", () => {
  it("accepts positive int4 ids", () => {
    expect(parseEmployeeId("1")).toBe(1);
    expect(parseEmployeeId("2147483647")).toBe(2147483647);
  });

  it.each([undefined, "", "0", "-1", "01", "1.5", "1e3", " 1", "abc", "2147483648", "99999999999"])(
    "rejects %s",
    (raw) => {
      expect(parseEmployeeId(raw)).toBeNull();
    },
  );
});

const active: EmployeeAccessRow = {
  id: 7,
  firstName: "Anna",
  lastName: "Nowak",
  isHrAdmin: false,
  isActive: true,
  isWhiteCollar: true,
};

describe("decideAccess", () => {
  it("denies an account that is not in the employee table", () => {
    expect(decideAccess(null)).toEqual({ kind: "no-access", reason: "UNKNOWN" });
  });

  it("denies an inactive employee", () => {
    expect(decideAccess({ ...active, isActive: false })).toEqual({ kind: "no-access", reason: "INACTIVE" });
  });

  it("denies a non-White-Collar employee", () => {
    expect(decideAccess({ ...active, isWhiteCollar: false })).toEqual({ kind: "no-access", reason: "NOT_WHITE_COLLAR" });
  });

  it("reports INACTIVE first when both flags fail", () => {
    expect(decideAccess({ ...active, isActive: false, isWhiteCollar: false })).toEqual({
      kind: "no-access",
      reason: "INACTIVE",
    });
  });

  it("lets an active White Collar employee in and exposes only the narrow identity", () => {
    expect(decideAccess({ ...active, isHrAdmin: true })).toEqual({
      kind: "ok",
      employee: { id: 7, firstName: "Anna", lastName: "Nowak", isHrAdmin: true },
    });
  });
});
