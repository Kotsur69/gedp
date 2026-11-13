import "server-only";
import type { PrismaClient } from "@/generated/prisma/client";
import { HIERARCHY_TX_OPTIONS, rebuildHierarchy } from "@/server/hierarchy";
import { generatePassword, hashPassword } from "@/server/passwords";

// Synthetic test accounts with a password, one per role, in their own small branch:
//   test4 (N+2) -> test2 (N+1) -> test, test3 (employees);  test5 = HR admin.
// example.com is reserved for documentation/tests, so no e-mail can ever reach a real person.

export type TestRole = "employee" | "manager" | "seniorManager" | "hrAdmin";

export interface TestAccount {
  email: string;
  amei: string;
  firstName: string;
  lastName: string;
  role: TestRole;
  managerEmail: string | null;
}

// Managers before their reports.
export const TEST_ACCOUNTS: readonly TestAccount[] = [
  { email: "test4@example.com", amei: "AMTEST0004", firstName: "Karol", lastName: "Test", role: "seniorManager", managerEmail: null },
  { email: "test2@example.com", amei: "AMTEST0002", firstName: "Marek", lastName: "Test", role: "manager", managerEmail: "test4@example.com" },
  { email: "test@example.com", amei: "AMTEST0001", firstName: "Anna", lastName: "Test", role: "employee", managerEmail: "test2@example.com" },
  { email: "test3@example.com", amei: "AMTEST0003", firstName: "Julia", lastName: "Test", role: "employee", managerEmail: "test2@example.com" },
  { email: "test5@example.com", amei: "AMTEST0005", firstName: "Hanna", lastName: "Test", role: "hrAdmin", managerEmail: null },
];

export interface IssuedLogin {
  email: string;
  password: string;
  role: TestRole;
  name: string;
}

/**
 * Creates or updates the test accounts and gives each a NEW random password (old ones stop
 * working). Returns the plain passwords exactly once; only scrypt hashes are stored.
 */
export async function upsertTestLogins(db: PrismaClient): Promise<IssuedLogin[]> {
  const issued = TEST_ACCOUNTS.map((account) => ({ account, password: generatePassword() }));
  const hashes = await Promise.all(issued.map(({ password }) => hashPassword(password)));

  await db.$transaction(async (tx) => {
    const idByEmail = new Map<string, number>();
    for (const [index, { account }] of issued.entries()) {
      const managerId = account.managerEmail ? idByEmail.get(account.managerEmail) : null;
      if (managerId === undefined) throw new Error(`Manager of ${account.email} must be listed before it`);
      const data = {
        amei: account.amei,
        firstName: account.firstName,
        lastName: account.lastName,
        managerId,
        department: "Test",
        isActive: true,
        isWhiteCollar: true,
        isHrAdmin: account.role === "hrAdmin",
      };
      const employee = await tx.employee.upsert({
        where: { email: account.email },
        create: { email: account.email, ...data },
        update: data,
        select: { id: true },
      });
      idByEmail.set(account.email, employee.id);
      await tx.loginCredential.upsert({
        where: { employeeId: employee.id },
        create: { employeeId: employee.id, passwordHash: hashes[index] },
        update: { passwordHash: hashes[index] },
      });
    }
    await rebuildHierarchy(tx);
  }, HIERARCHY_TX_OPTIONS);

  return issued.map(({ account, password }) => ({
    email: account.email,
    password,
    role: account.role,
    name: `${account.firstName} ${account.lastName}`,
  }));
}
