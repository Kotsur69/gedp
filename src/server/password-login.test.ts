import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, hasTestDb, resetTestDb } from "../../tests/setup/db-client";
import { authenticateWithPassword } from "./password-login";
import { permissionsForEmployee } from "./permissions";
import { TEST_ACCOUNTS, upsertTestLogins, type IssuedLogin } from "./test-logins";

describe.skipIf(!hasTestDb)("password login + test accounts (database)", () => {
  const db = createTestDb();
  let logins: IssuedLogin[];
  const login = (email: string): IssuedLogin => {
    const found = logins.find((l) => l.email === email);
    if (!found) throw new Error(`no login for ${email}`);
    return found;
  };

  beforeAll(async () => {
    await resetTestDb(db);
  });

  beforeEach(async () => {
    logins = await upsertTestLogins(db);
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("creates one account per role on example.com and stores only hashes", async () => {
    expect(logins.map((l) => l.email).sort()).toEqual(TEST_ACCOUNTS.map((a) => a.email).sort());
    expect(logins.every((l) => l.email.endsWith("@example.com"))).toBe(true);
    const rows = await db.loginCredential.findMany({ select: { passwordHash: true } });
    expect(rows).toHaveLength(TEST_ACCOUNTS.length);
    for (const row of rows) {
      expect(row.passwordHash.startsWith("scrypt$")).toBe(true);
      expect(logins.some((l) => row.passwordHash.includes(l.password))).toBe(false);
    }
  });

  it("signs in with the issued password, case-insensitively on the e-mail", async () => {
    const anna = login("test@example.com");
    const identity = await authenticateWithPassword(db, { email: "  TEST@Example.com ", password: anna.password });
    expect(identity).toMatchObject({ email: "test@example.com", name: "Anna Test" });
    expect(Number(identity?.id)).toBeGreaterThan(0);
  });

  it("rejects a wrong password, an unknown e-mail, a seeded person without a password and junk input", async () => {
    const anna = login("test@example.com");
    expect(await authenticateWithPassword(db, { email: anna.email, password: `${anna.password}x` })).toBeNull();
    expect(await authenticateWithPassword(db, { email: "nobody@example.com", password: anna.password })).toBeNull();
    await db.employee.upsert({
      where: { email: "nopass@example.com" },
      create: { amei: "AM0NOPASS", email: "nopass@example.com", firstName: "No", lastName: "Pass" },
      update: {},
    });
    expect(await authenticateWithPassword(db, { email: "nopass@example.com", password: "anything" })).toBeNull();
    for (const junk of [null, {}, { email: "not-an-email", password: "x" }, { email: anna.email }, "x"]) {
      expect(await authenticateWithPassword(db, junk)).toBeNull();
    }
  });

  it("running it again rotates every password", async () => {
    const before = login("test2@example.com").password;
    const again = await upsertTestLogins(db);
    const after = again.find((l) => l.email === "test2@example.com")?.password ?? "";
    expect(after).not.toBe(before);
    expect(await authenticateWithPassword(db, { email: "test2@example.com", password: before })).toBeNull();
    expect(await authenticateWithPassword(db, { email: "test2@example.com", password: after })).not.toBeNull();
    expect(await db.employee.count({ where: { amei: { startsWith: "AMTEST" } } })).toBe(TEST_ACCOUNTS.length);
  });

  it("the accounts get the intended roles in the live structure", async () => {
    const rows = await db.employee.findMany({ where: { amei: { startsWith: "AMTEST" } }, select: { email: true, id: true } });
    const ids = new Map(rows.map((e) => [e.email, e.id]));
    const id = (email: string): number => ids.get(email) ?? -1;
    const as = (email: string) => ({ id: id(email), isHrAdmin: false });

    expect(await permissionsForEmployee(db, as("test2@example.com"), id("test@example.com"))).toEqual({
      view: true,
      edit: false,
      validate: true,
    });
    expect(await permissionsForEmployee(db, as("test4@example.com"), id("test@example.com"))).toEqual({
      view: true,
      edit: false,
      validate: false,
    });
    expect((await permissionsForEmployee(db, as("test@example.com"), id("test3@example.com"))).view).toBe(false);
    const hr = await db.employee.findUniqueOrThrow({ where: { email: "test5@example.com" }, select: { isHrAdmin: true } });
    expect(hr.isHrAdmin).toBe(true);
  });
});
