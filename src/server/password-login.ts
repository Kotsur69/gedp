import "server-only";
import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import { generatePassword, hashPassword, MAX_PASSWORD_LENGTH, verifyPassword } from "@/server/passwords";

// Password sign-in for test / demo accounts (AUTH_PASSWORD_LOGIN). Returns the identity Auth.js
// stores in the session (sub = employee id) or null. The access gate still runs on every
// request, so an inactive or non-White-Collar account lands on "no access" as usual.

const MAX_EMAIL_LENGTH = 254;

const credentialsInput = z.object({
  email: z.string().trim().toLowerCase().max(MAX_EMAIL_LENGTH).pipe(z.email()),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

export interface SignedInIdentity {
  id: string;
  email: string;
  name: string;
}

type EmployeeReader = Pick<PrismaClient, "employee">;

// Verified against when the e-mail is unknown or has no password, so response time does not
// reveal which addresses have accounts. Same cost parameters as real hashes (hashPassword).
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(generatePassword()).catch((error: unknown) => {
    dummyHash = undefined; // retry next time instead of caching a rejection forever
    throw error;
  });
  return dummyHash;
}

// Each attempt costs one scrypt run (~32 MB, tens of ms). Above this many at once in one server
// instance, further attempts fail fast instead of queueing, so a flood of sign-ins cannot starve
// the instance. Real throttling belongs in front of the app (Vercel firewall / reverse proxy).
export const MAX_CONCURRENT_SIGN_INS = 4;
let activeSignIns = 0;

export async function authenticateWithPassword(db: EmployeeReader, raw: unknown): Promise<SignedInIdentity | null> {
  const parsed = credentialsInput.safeParse(raw);
  if (!parsed.success) return null;
  if (activeSignIns >= MAX_CONCURRENT_SIGN_INS) return null;
  activeSignIns += 1;
  try {
    return await checkCredentials(db, parsed.data.email, parsed.data.password);
  } finally {
    activeSignIns -= 1;
  }
}

async function checkCredentials(db: EmployeeReader, email: string, password: string): Promise<SignedInIdentity | null> {
  // E-mails are stored lower-case (seed, import and create-test-logins all normalise).
  const employee = await db.employee.findUnique({
    where: { email },
    select: { id: true, email: true, firstName: true, lastName: true, loginCredential: { select: { passwordHash: true } } },
  });
  const storedHash = employee?.loginCredential?.passwordHash;
  if (!employee || !storedHash) {
    await verifyPassword(password, await getDummyHash());
    return null;
  }
  if (!(await verifyPassword(password, storedHash))) return null;
  return { id: String(employee.id), email: employee.email, name: `${employee.firstName} ${employee.lastName}` };
}
