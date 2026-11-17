import { beforeEach, describe, expect, it, vi } from "vitest";

const requireEmployee = vi.fn();
vi.mock("@/server/current-employee", () => ({ requireEmployee }));

const fakeDb = { marker: "db" };
vi.mock("@/server/db", () => ({ db: () => fakeDb }));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));

const updateEmployee = vi.fn();
vi.mock("@/server/employee-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/employee-admin")>()),
  updateEmployee,
}));

const { updateEmployeeAction } = await import("./actions");
const { EmployeeAdminError } = await import("@/server/employee-admin");
const { ForbiddenError } = await import("@/server/permissions");

const HR = { id: 1, firstName: "Hanna", lastName: "Kadrowa", isHrAdmin: true };
const EMPLOYEE = { id: 2, firstName: "Jan", lastName: "Testowy", isHrAdmin: false };
const INPUT = { employeeId: 5 };

beforeEach(() => {
  requireEmployee.mockReset().mockResolvedValue(HR);
  updateEmployee.mockReset().mockResolvedValue({ changes: [{ field: "department", before: null, after: "IT" }] });
  refresh.mockReset();
});

describe("[HR-04] updateEmployeeAction", () => {
  it("refuses a non-HR viewer without touching the database", async () => {
    requireEmployee.mockResolvedValue(EMPLOYEE);
    expect(await updateEmployeeAction(INPUT)).toEqual({ ok: false, code: "FORBIDDEN", fieldErrors: {} });
    expect(updateEmployee).not.toHaveBeenCalled();
  });

  it("passes the session viewer (never the payload) and refreshes the list after a change", async () => {
    expect(await updateEmployeeAction(INPUT)).toEqual({ ok: true, changed: true });
    expect(updateEmployee).toHaveBeenCalledWith(fakeDb, HR, INPUT);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not refresh when nothing changed", async () => {
    updateEmployee.mockResolvedValue({ changes: [] });
    expect(await updateEmployeeAction(INPUT)).toEqual({ ok: true, changed: false });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("returns a cycle as a field error on the manager", async () => {
    updateEmployee.mockRejectedValue(new EmployeeAdminError("HIERARCHY_CYCLE", { managerAmei: "HIERARCHY_CYCLE" }));
    expect(await updateEmployeeAction(INPUT)).toEqual({
      ok: false,
      code: "HIERARCHY_CYCLE",
      fieldErrors: { managerAmei: "HIERARCHY_CYCLE" },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes the list when the form was stale", async () => {
    updateEmployee.mockRejectedValue(new EmployeeAdminError("STALE"));
    expect(await updateEmployeeAction(INPUT)).toMatchObject({ ok: false, code: "STALE" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("maps access errors to FORBIDDEN and hides unexpected errors behind FAILED", async () => {
    updateEmployee.mockRejectedValueOnce(new ForbiddenError("edit"));
    expect(await updateEmployeeAction(INPUT)).toMatchObject({ ok: false, code: "FORBIDDEN" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    updateEmployee.mockRejectedValueOnce(Object.assign(new Error("secret query args"), { code: "P2002" }));
    expect(await updateEmployeeAction(INPUT)).toMatchObject({ ok: false, code: "FAILED" });
    expect(log).toHaveBeenCalledWith("[admin/employees] update failed: Error (P2002)");
    log.mockRestore();
  });
});
