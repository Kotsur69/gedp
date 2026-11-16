import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@/generated/prisma/client";
import { isInSubtree, subtreeIds } from "@/server/hierarchy";
import { ForbiddenError } from "@/server/permissions";
import { createTestDb, hasTestDb, resetTestDb } from "../../../tests/setup/db-client";
import { confirmImport, ImportBlockedError, ImportStaleError, previewImport, toPreview, type ImportPlan } from "./pipeline";
import { structureImport } from "./structure";
import type { ImportFile } from "./table";

const DIR = join(process.cwd(), "tests", "fixtures", "import");
const fixture = (name: string): ImportFile => ({ fileName: name, bytes: readFileSync(join(DIR, name)) });
/** valid.csv with its text transformed. */
const validVariant = (transform: (csv: string) => string, fileName = "variant.csv"): ImportFile => ({
  fileName,
  bytes: Buffer.from(transform(readFileSync(join(DIR, "valid.csv"), "utf8")), "utf8"),
});

const HR = { id: 1, isHrAdmin: true };
const NOT_HR = { id: 1, isHrAdmin: false };
const NO_DB = {} as PrismaClient; // any DB access would throw
const ANY_FINGERPRINT = "0".repeat(64);

describe("import pipeline - without a database", () => {
  const plan: ImportPlan<{ key: string }> = {
    kind: "STRUKTURA",
    totalRows: 1,
    created: [],
    changed: [],
    deactivated: [],
    unchangedCount: 1,
    errors: [
      { line: 2, column: "a", code: "X", message: "x" },
      { line: 2, column: "b", code: "Y", message: "y" },
    ],
    fileErrors: [],
  };

  it("fingerprints the file and the plan; counts error ROWS", () => {
    const file = { fileName: "a.csv", bytes: Buffer.from("x") };
    const preview = toPreview(file, plan);
    expect(preview.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(preview.errorRowCount).toBe(1);
    expect(toPreview(file, plan).fingerprint).toBe(preview.fingerprint);
    expect(toPreview({ ...file, bytes: Buffer.from("y") }, plan).fingerprint).not.toBe(preview.fingerprint);
    expect(toPreview(file, { ...plan, unchangedCount: 2 }).fingerprint).not.toBe(preview.fingerprint);
  });

  it("only HR may preview or confirm", async () => {
    await expect(previewImport(NO_DB, structureImport, NOT_HR, fixture("valid.csv"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmImport(NO_DB, structureImport, NOT_HR, fixture("valid.csv"), { mode: "IMPORT_VALID_ROWS", fingerprint: ANY_FINGERPRINT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("REJECT_ALL never touches the database", async () => {
    const result = await confirmImport(NO_DB, structureImport, HR, fixture("bad-date.csv"), {
      mode: "REJECT_ALL",
      fingerprint: ANY_FINGERPRINT,
    });
    expect(result).toEqual({ status: "REJECTED" });
  });

  it("validates the confirm request", async () => {
    const bad = { mode: "IMPORT_EVERYTHING", fingerprint: "nope" } as never;
    await expect(confirmImport(NO_DB, structureImport, HR, fixture("valid.csv"), bad)).rejects.toThrow();
  });
});

describe.skipIf(!hasTestDb)("import pipeline - database", () => {
  const db = hasTestDb ? createTestDb() : null!;
  let hr: { id: number; isHrAdmin: true };

  const idOf = async (amei: string) => (await db.employee.findUniqueOrThrow({ where: { amei } })).id;
  const tableCounts = async () => ({
    employees: await db.employee.count(),
    hierarchy: await db.employeeHierarchy.count(),
    audit: await db.auditLog.count(),
    batches: await db.importBatch.count(),
  });

  async function importFile(file: ImportFile) {
    const preview = await previewImport(db, structureImport, hr, file);
    const result = await confirmImport(db, structureImport, hr, file, {
      mode: "IMPORT_VALID_ROWS",
      fingerprint: preview.fingerprint,
    });
    return { preview, result };
  }

  beforeEach(async () => {
    await resetTestDb(db);
    // The HR person who runs the first import is in the file too (AM0090003, hr_admin TAK).
    const actor = await db.employee.create({
      data: { amei: "AM0090003", email: "ewa.zielinska.3@example.com", firstName: "Ewa", lastName: "Zielinska", isHrAdmin: true },
    });
    hr = { id: actor.id, isHrAdmin: true };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("[HR-02] preview writes nothing", async () => {
    const before = await tableCounts();
    const preview = await previewImport(db, structureImport, hr, fixture("valid.csv"));
    expect(preview).toMatchObject({ fileName: "valid.csv", errorRowCount: 0 });
    expect(preview.created).toHaveLength(11);
    expect(preview.changed.map((c) => c.key)).toEqual(["AM0090003"]);
    expect(await tableCounts()).toEqual(before);
  });

  it("[HR-01] confirm writes employees, import_batch, audit and the hierarchy", async () => {
    const { result } = await importFile(fixture("valid.csv"));
    expect(result).toMatchObject({
      status: "IMPORTED",
      counts: { newCount: 11, changedCount: 1, deactivatedCount: 0, errorCount: 0 },
    });
    if (result.status !== "IMPORTED") throw new Error("expected an import");

    const anna = await db.employee.findUniqueOrThrow({ where: { amei: "AM0090001" } });
    expect(anna).toMatchObject({ managerId: null, department: "Zarząd", isHrAdmin: false });
    expect(anna.hireDate?.toISOString()).toBe("2011-02-01T00:00:00.000Z");
    expect((await db.employee.findUniqueOrThrow({ where: { amei: "AM0090010" } })).isActive).toBe(false);
    expect((await db.employee.findUniqueOrThrow({ where: { id: hr.id } })).managerId).toBe(anna.id);

    expect(await subtreeIds(db, anna.id)).toHaveLength(11);
    expect(await isInSubtree(db, await idOf("AM0090002"), await idOf("AM0090012"))).toBe(true);

    const batch = await db.importBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch).toMatchObject({ fileName: "valid.csv", kind: "STRUKTURA", authorId: hr.id, newCount: 11, changedCount: 1 });

    const audit = await db.auditLog.findMany({ orderBy: { id: "asc" } });
    expect(audit.filter((a) => a.action === "IMPORT_CREATE")).toHaveLength(11);
    const update = audit.find((a) => a.action === "IMPORT_UPDATE");
    expect(update).toMatchObject({ entity: "employee", entityId: String(hr.id), actorId: hr.id });
    expect(update?.after).toMatchObject({ managerAmei: "AM0090001", importBatchId: result.batchId });
    expect(audit.at(-1)).toMatchObject({ entity: "import_batch", entityId: String(result.batchId), action: "IMPORT" });
  });

  it("[ACC-04] deactivation keeps the person's documents", async () => {
    await importFile(fixture("valid.csv"));
    const grzegorz = await idOf("AM0090012");
    const cycle = await db.cycle.create({ data: { year: 2027 } });
    const document = await db.gedpDocument.create({ data: { employeeId: grzegorz, cycleId: cycle.id } });

    const { result } = await importFile(fixture("deactivation.csv"));
    expect(result).toMatchObject({ counts: { newCount: 0, changedCount: 0, deactivatedCount: 1 } });
    expect((await db.employee.findUniqueOrThrow({ where: { id: grzegorz } })).isActive).toBe(false);
    expect(await db.gedpDocument.findUnique({ where: { id: document.id } })).not.toBeNull();
    expect(await db.auditLog.count({ where: { action: "IMPORT_DEACTIVATE", entityId: String(grzegorz) } })).toBe(1);
  });

  it("rebuilds the hierarchy after a manager move", async () => {
    await importFile(fixture("valid.csv"));
    const moved = validVariant((csv) =>
      csv.replace(
        "AM0090012;grzegorz.lewandowski.12@example.com;Grzegorz;Lewandowski;AM0090004",
        "AM0090012;grzegorz.lewandowski.12@example.com;Grzegorz;Lewandowski;AM0090005",
      ),
    );
    await importFile(moved);
    expect(await isInSubtree(db, await idOf("AM0090004"), await idOf("AM0090012"))).toBe(false);
    expect(await isInSubtree(db, await idOf("AM0090005"), await idOf("AM0090012"))).toBe(true);
  });

  it("[HR-02] imports only the valid rows of a file with errors", async () => {
    const { preview, result } = await importFile(fixture("bad-boolean.csv"));
    expect(preview.errors.map((e) => [e.line, e.code])).toEqual([
      [7, "INVALID_BOOLEAN"],
      [8, "INVALID_BOOLEAN"],
    ]);
    expect(result).toMatchObject({ counts: { newCount: 9, changedCount: 1, errorCount: 2 } });
    expect(await db.employee.findUnique({ where: { amei: "AM0090006" } })).toBeNull();
    expect(await db.employee.count()).toBe(10);
  });

  it("[HR-02] REJECT_ALL writes nothing", async () => {
    const before = await tableCounts();
    const preview = await previewImport(db, structureImport, hr, fixture("bad-date.csv"));
    const result = await confirmImport(db, structureImport, hr, fixture("bad-date.csv"), {
      mode: "REJECT_ALL",
      fingerprint: preview.fingerprint,
    });
    expect(result).toEqual({ status: "REJECTED" });
    expect(await tableCounts()).toEqual(before);
  });

  it("refuses to confirm when the data or the file changed after the preview, writing nothing", async () => {
    const preview = await previewImport(db, structureImport, hr, fixture("valid.csv"));
    await db.employee.update({ where: { id: hr.id }, data: { department: "Changed meanwhile" } });
    const before = await tableCounts();
    const request = { mode: "IMPORT_VALID_ROWS", fingerprint: preview.fingerprint } as const;
    await expect(confirmImport(db, structureImport, hr, fixture("valid.csv"), request)).rejects.toBeInstanceOf(ImportStaleError);
    await expect(
      confirmImport(db, structureImport, hr, fixture("polish-characters.csv"), request),
    ).rejects.toBeInstanceOf(ImportStaleError);
    expect(await tableCounts()).toEqual(before);
  });

  it("refuses a file with blocking errors", async () => {
    const file = validVariant((csv) => csv.replace("amei_przelozonego", "manager"), "no-manager-column.csv");
    const preview = await previewImport(db, structureImport, hr, file);
    expect(preview.fileErrors.map((e) => e.code)).toEqual(["MISSING_COLUMN"]);
    await expect(
      confirmImport(db, structureImport, hr, file, { mode: "IMPORT_VALID_ROWS", fingerprint: preview.fingerprint }),
    ).rejects.toBeInstanceOf(ImportBlockedError);
    expect(await db.importBatch.count()).toBe(0);
  });

  it("swaps two people's e-mails without hitting the unique index", async () => {
    await importFile(fixture("valid.csv"));
    const swapped = validVariant((csv) =>
      csv
        .replace("anna.nowak.1@example.com", "SWAP")
        .replace("piotr.kowalczyk.2@example.com", "anna.nowak.1@example.com")
        .replace("SWAP", "piotr.kowalczyk.2@example.com"),
    );
    const { result } = await importFile(swapped);
    expect(result).toMatchObject({ counts: { changedCount: 2 } });
    expect((await db.employee.findUniqueOrThrow({ where: { amei: "AM0090001" } })).email).toBe("piotr.kowalczyk.2@example.com");
    expect((await db.employee.findUniqueOrThrow({ where: { amei: "AM0090002" } })).email).toBe("anna.nowak.1@example.com");
  });
});

describe.skipIf(!hasTestDb)("import pipeline - database guards", () => {
  const db = hasTestDb ? createTestDb() : null!;
  let hr: { id: number; isHrAdmin: true };

  beforeEach(async () => {
    await resetTestDb(db);
    const actor = await db.employee.create({
      data: { amei: "AM0090003", email: "ewa.zielinska.3@example.com", firstName: "Ewa", lastName: "Zielinska", isHrAdmin: true },
    });
    hr = { id: actor.id, isHrAdmin: true };
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("re-checks the actor in the database: a deactivated or demoted HR user may not import", async () => {
    const preview = await previewImport(db, structureImport, hr, fixture("valid.csv"));
    await db.employee.update({ where: { id: hr.id }, data: { isHrAdmin: false } });
    await expect(previewImport(db, structureImport, hr, fixture("valid.csv"))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmImport(db, structureImport, hr, fixture("valid.csv"), { mode: "IMPORT_VALID_ROWS", fingerprint: preview.fingerprint }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await db.employee.update({ where: { id: hr.id }, data: { isHrAdmin: true, isActive: false } });
    await expect(previewImport(db, structureImport, hr, fixture("valid.csv"))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await db.importBatch.count()).toBe(0);
  });

  it("[SELF_LOCKOUT] will not remove the importing HR user's own access", async () => {
    const file = validVariant((csv) => csv.replace("2013-04-01;TAK", "2013-04-01;NIE"), "demote-me.csv");
    const preview = await previewImport(db, structureImport, hr, file);
    expect(preview.fileErrors.map((e) => e.code)).toEqual(["SELF_LOCKOUT"]);
    await expect(
      confirmImport(db, structureImport, hr, file, { mode: "IMPORT_VALID_ROWS", fingerprint: preview.fingerprint }),
    ).rejects.toBeInstanceOf(ImportBlockedError);
    expect((await db.employee.findUniqueOrThrow({ where: { id: hr.id } })).isHrAdmin).toBe(true);
  });

  it("stores only the base name of the uploaded file and caps the scope size", async () => {
    const file = { ...fixture("valid.csv"), fileName: String.raw`C:\Users\hr\Desktop\struktura.csv` };
    const preview = await previewImport(db, structureImport, hr, file);
    expect(preview.fileName).toBe("struktura.csv");
    await expect(
      confirmImport(db, structureImport, hr, file, {
        mode: "IMPORT_VALID_ROWS",
        fingerprint: preview.fingerprint,
        scope: { note: "x".repeat(20_000) },
      }),
    ).rejects.toThrow("Import scope is too large");
    const result = await confirmImport(db, structureImport, hr, file, {
      mode: "IMPORT_VALID_ROWS",
      fingerprint: preview.fingerprint,
      scope: { departments: "all" },
    });
    if (result.status !== "IMPORTED") throw new Error("expected an import");
    expect(await db.importBatch.findUniqueOrThrow({ where: { id: result.batchId } })).toMatchObject({
      fileName: "struktura.csv",
      scope: { departments: "all" },
    });
  });
});
