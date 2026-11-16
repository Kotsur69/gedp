import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

const requireEmployee = vi.fn();
vi.mock("@/server/current-employee", () => ({ requireEmployee }));

const loadCycleOptions = vi.fn();
vi.mock("@/server/cycles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/cycles")>()),
  loadCycleOptions,
}));

const { setCycleYearAction } = await import("./cycle-actions");

const EMPLOYEE = { id: 7, firstName: "Anna", lastName: "Test", isHrAdmin: false };

describe("[NFR-05] setCycleYearAction", () => {
  beforeEach(() => {
    set.mockReset();
    requireEmployee.mockReset().mockResolvedValue(EMPLOYEE);
    loadCycleOptions.mockReset().mockResolvedValue([
      { year: 2027, status: "OTWARTY" },
      { year: 2026, status: "ZAMKNIETY" },
    ]);
  });

  it("stores a year the person may see in an httpOnly cookie", async () => {
    await setCycleYearAction(2026);
    expect(loadCycleOptions).toHaveBeenCalledWith(false);
    expect(set).toHaveBeenCalledWith(
      "GEDP_CYCLE_YEAR",
      "2026",
      expect.objectContaining({ path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true }),
    );
  });

  it("checks the year against the cycles offered to THIS person (HR sees more)", async () => {
    requireEmployee.mockResolvedValue({ ...EMPLOYEE, isHrAdmin: true });
    loadCycleOptions.mockResolvedValue([{ year: 2028, status: "PRZYGOTOWANIE" }]);
    await setCycleYearAction(2028);
    expect(loadCycleOptions).toHaveBeenCalledWith(true);
    expect(set).toHaveBeenCalledWith("GEDP_CYCLE_YEAR", "2028", expect.anything());
  });

  it("refuses a valid year that is not on offer, without writing a cookie", async () => {
    await expect(setCycleYearAction(2028)).rejects.toThrow("Cycle year not available");
    expect(set).not.toHaveBeenCalled();
  });

  it.each(["2026", "abc", null, 2026.5, 1999, { year: 2026 }])("rejects malformed input %j", async (value) => {
    await expect(setCycleYearAction(value)).rejects.toThrow("Invalid cycle year");
    expect(requireEmployee).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("requires a signed-in employee (requireEmployee redirects otherwise)", async () => {
    requireEmployee.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(setCycleYearAction(2026)).rejects.toThrow("NEXT_REDIRECT");
    expect(set).not.toHaveBeenCalled();
  });
});
