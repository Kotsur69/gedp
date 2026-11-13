import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("@/server/db", () => ({ db: () => ({ employee: { findUnique: mocks.findUnique } }) }));

const { getAccess, requireEmployee } = await import("./current-employee");

const row = { id: 7, firstName: "Anna", lastName: "Test", isHrAdmin: false, isActive: true, isWhiteCollar: true };

describe("current employee (ACC-01, ACC-04)", () => {
  beforeEach(() => {
    mocks.auth.mockReset();
    mocks.findUnique.mockReset();
  });

  it("no session or a malformed session id means signed out, without touching the database", async () => {
    for (const session of [null, { user: {} }, { user: { id: "abc" } }, { user: { id: "99999999999" } }]) {
      mocks.auth.mockResolvedValueOnce(session);
      expect(await getAccess()).toEqual({ kind: "signed-out" });
    }
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("re-reads the employee row on every request, so deactivation applies at once", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "7" } });
    mocks.findUnique.mockResolvedValueOnce(row).mockResolvedValueOnce({ ...row, isActive: false });
    expect(await getAccess()).toMatchObject({ kind: "ok", employee: { id: 7 } });
    expect(await getAccess()).toEqual({ kind: "no-access", reason: "INACTIVE" });
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 7 } }));
  });

  it("requireEmployee returns the narrow employee or redirects", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "7" } });
    mocks.findUnique.mockResolvedValueOnce(row);
    expect(await requireEmployee()).toEqual({ id: 7, firstName: "Anna", lastName: "Test", isHrAdmin: false });

    mocks.findUnique.mockResolvedValueOnce({ ...row, isWhiteCollar: false });
    await expect(requireEmployee()).rejects.toThrow("REDIRECT /no-access");

    mocks.auth.mockResolvedValueOnce(null);
    await expect(requireEmployee()).rejects.toThrow("REDIRECT /login");
  });
});
