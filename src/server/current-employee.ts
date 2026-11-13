import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { db } from "@/server/db";
import { decideAccess, parseEmployeeId, type AccessDecision, type CurrentEmployee } from "@/server/access";

// Data Access Layer entry point: the ONLY way pages and server actions learn who is signed in.
// Deduplicated per request; always re-reads the employee row, so deactivation applies at once.
export const getAccess = cache(async (): Promise<AccessDecision> => {
  const session = await auth();
  const employeeId = parseEmployeeId(session?.user?.id);
  if (employeeId === null) return { kind: "signed-out" };

  const employee = await db().employee.findUnique({
    where: { id: employeeId },
    select: { id: true, firstName: true, lastName: true, isHrAdmin: true, isActive: true, isWhiteCollar: true },
  });
  return decideAccess(employee);
});

/** Returns the signed-in employee or redirects (to /login or /no-access). Call in every protected page/action. */
export async function requireEmployee(): Promise<CurrentEmployee> {
  const access = await getAccess();
  if (access.kind === "signed-out") redirect("/login");
  if (access.kind === "no-access") redirect("/no-access");
  return access.employee;
}
