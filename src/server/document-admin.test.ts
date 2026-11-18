import { describe, expect, it, vi } from "vitest";
import {
  DOCUMENT_LIST_LIMIT,
  documentListWhere,
  listDocumentsForHr,
  parseDocumentListFilters,
  type DocumentAdminDb,
} from "./document-admin";
import { ForbiddenError } from "./permissions";

const HR = { id: 1, isHrAdmin: true };
const CYCLE_ID = 7;

describe("[WF-08] HR document list - filters", () => {
  it("defaults to no filter and ignores invalid or repeated params", () => {
    expect(parseDocumentListFilters({})).toEqual({ q: "", status: null });
    expect(parseDocumentListFilters({ status: "DONE", q: "x".repeat(101) })).toEqual({ q: "", status: null });
    expect(parseDocumentListFilters({ status: ["ZATWIERDZONY", "SZKIC"], q: [" Jan ", "x"] })).toEqual({
      q: "Jan",
      status: "ZATWIERDZONY",
    });
  });

  it("always scopes to the cycle and requires every search word", () => {
    expect(documentListWhere(CYCLE_ID, parseDocumentListFilters({}))).toEqual({ cycleId: CYCLE_ID });
    const where = documentListWhere(CYCLE_ID, parseDocumentListFilters({ q: "jan  am12", status: "DO_WALIDACJI" }));
    expect(where).toMatchObject({ cycleId: CYCLE_ID, status: "DO_WALIDACJI" });
    const terms = (where.employee as { AND: unknown[] }).AND;
    expect(terms).toHaveLength(2);
    expect(terms[1]).toEqual({
      OR: [
        { firstName: { contains: "am12", mode: "insensitive" } },
        { lastName: { contains: "am12", mode: "insensitive" } },
        { amei: { contains: "am12", mode: "insensitive" } },
      ],
    });
  });
});

describe("[WF-08] listDocumentsForHr", () => {
  function mockDb(isLiveHr: boolean) {
    const row = {
      id: 10,
      status: "ZATWIERDZONY",
      updatedAt: new Date("2027-02-01T09:00:00Z"),
      employee: {
        amei: "AM1",
        firstName: "Anna",
        lastName: "Nowak",
        department: "IT",
        isActive: true,
        manager: null,
        validatorOverride: { amei: "OV1", firstName: "Olga", lastName: "Wolska" },
      },
    };
    return {
      employee: { findFirst: vi.fn().mockResolvedValue(isLiveHr ? { id: HR.id } : null) },
      gedpDocument: { count: vi.fn().mockResolvedValue(1), findMany: vi.fn().mockResolvedValue([row]) },
    };
  }

  it("refuses non-HR and an HR session whose live row lost HR rights, before reading documents", async () => {
    const nonHr = mockDb(true);
    await expect(
      listDocumentsForHr(nonHr as unknown as DocumentAdminDb, { id: 2, isHrAdmin: false }, CYCLE_ID, parseDocumentListFilters({})),
    ).rejects.toThrow(ForbiddenError);
    const demoted = mockDb(false);
    await expect(
      listDocumentsForHr(demoted as unknown as DocumentAdminDb, HR, CYCLE_ID, parseDocumentListFilters({})),
    ).rejects.toThrow(ForbiddenError);
    expect(nonHr.gedpDocument.findMany).not.toHaveBeenCalled();
    expect(demoted.gedpDocument.findMany).not.toHaveBeenCalled();
  });

  it("returns the rows with who validates them, capped at the list limit", async () => {
    const db = mockDb(true);
    const list = await listDocumentsForHr(db as unknown as DocumentAdminDb, HR, CYCLE_ID, parseDocumentListFilters({}));
    expect(list).toEqual({
      total: 1,
      items: [
        {
          documentId: 10,
          status: "ZATWIERDZONY",
          updatedAt: new Date("2027-02-01T09:00:00Z"),
          employeeName: "Anna Nowak",
          amei: "AM1",
          department: "IT",
          isActive: true,
          manager: null,
          validatorOverride: { amei: "OV1", name: "Olga Wolska" },
        },
      ],
    });
    expect(db.gedpDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { cycleId: CYCLE_ID }, take: DOCUMENT_LIST_LIMIT }),
    );
  });
});
