import { describe, expect, it, vi } from "vitest";

// Pure rules only; the session lookup (next-auth) is not needed here.
vi.mock("@/server/current-employee", () => ({ requireEmployee: vi.fn() }));

import { leadsTeam, visibleTabIds, type TeamReader } from "./navigation";

describe("[HOME-12] visibleTabIds", () => {
  it("an employee without reports sees the three common tabs", () => {
    expect(visibleTabIds({ isHrAdmin: false, leadsTeam: false })).toEqual([
      "gedpCycle",
      "myInformation",
      "helpAndSupport",
    ]);
  });

  it("a manager also sees 'Mój zespół'", () => {
    expect(visibleTabIds({ isHrAdmin: false, leadsTeam: true })).toEqual([
      "gedpCycle",
      "myInformation",
      "myTeam",
      "helpAndSupport",
    ]);
  });

  it("HR also sees 'Administrator', but not 'Mój zespół' without reports", () => {
    expect(visibleTabIds({ isHrAdmin: true, leadsTeam: false })).toEqual([
      "gedpCycle",
      "myInformation",
      "administrator",
      "helpAndSupport",
    ]);
  });

  it("an HR manager sees every tab in screen order", () => {
    expect(visibleTabIds({ isHrAdmin: true, leadsTeam: true })).toEqual([
      "gedpCycle",
      "myInformation",
      "myTeam",
      "administrator",
      "helpAndSupport",
    ]);
  });
});

describe("leadsTeam", () => {
  const readerReturning = (row: { id: number } | null) => {
    const findFirst = vi.fn().mockResolvedValue(row);
    return { reader: { employee: { findFirst } } as unknown as TeamReader, findFirst };
  };

  it("is true when someone reports to the person or has them as override validator", async () => {
    const { reader, findFirst } = readerReturning({ id: 12 });
    await expect(leadsTeam(reader, 7)).resolves.toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { OR: [{ managerId: 7 }, { validatorOverrideId: 7 }] },
      select: { id: true },
    });
  });

  it("is false when nobody does", async () => {
    const { reader } = readerReturning(null);
    await expect(leadsTeam(reader, 7)).resolves.toBe(false);
  });
});
