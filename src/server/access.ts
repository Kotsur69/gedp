// Pure access gate (ACC-01, ACC-03, ACC-04): who may see data after signing in.
// A signed-in account that is unknown, inactive or not White Collar sees no data at all.

export interface CurrentEmployee {
  id: number;
  firstName: string;
  lastName: string;
  isHrAdmin: boolean;
}

export type NoAccessReason = "UNKNOWN" | "INACTIVE" | "NOT_WHITE_COLLAR";

export type AccessDecision =
  | { kind: "signed-out" }
  | { kind: "no-access"; reason: NoAccessReason }
  | { kind: "ok"; employee: CurrentEmployee };

export interface EmployeeAccessRow extends CurrentEmployee {
  isActive: boolean;
  isWhiteCollar: boolean;
}

// employee.id is a Postgres int4; a larger value would make Prisma throw instead of "not found".
const MAX_INT4 = 2_147_483_647;

/** Session ids are strings; anything that is not a positive int4 is treated as no identity. */
export function parseEmployeeId(raw: string | undefined): number | null {
  if (raw === undefined || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const id = Number(raw);
  return id <= MAX_INT4 ? id : null;
}

export function decideAccess(employee: EmployeeAccessRow | null): AccessDecision {
  if (!employee) return { kind: "no-access", reason: "UNKNOWN" };
  if (!employee.isActive) return { kind: "no-access", reason: "INACTIVE" };
  if (!employee.isWhiteCollar) return { kind: "no-access", reason: "NOT_WHITE_COLLAR" };
  // Return a narrow object: only what the UI and permission checks need.
  const { id, firstName, lastName, isHrAdmin } = employee;
  return { kind: "ok", employee: { id, firstName, lastName, isHrAdmin } };
}
