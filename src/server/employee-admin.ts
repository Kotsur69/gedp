import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  employeeChanges,
  employeeEditFieldErrors,
  employeeEditSchema,
  type EditableEmployee,
  type EmployeeEditErrorCode,
  type EmployeeEditFieldErrors,
  type EmployeeFieldChange,
} from "@/domain/employee-edit";
import { writeAudit } from "@/server/audit";
import { HIERARCHY_TX_OPTIONS, HierarchyCycleError, lockHierarchy, rebuildHierarchy } from "@/server/hierarchy";
import { requireActiveHrAdmin, type Viewer } from "@/server/permissions";

// HR panel, employees (HR-04): the searchable list and the manual edit of one person, including the
// WF-09 override validator (employee.validatorOverrideId; who validates people without a manager).
//
// - HR only, checked against the live row (a demoted or deactivated HR user is refused at once).
// - The edit runs in ONE READ COMMITTED transaction (HIERARCHY_TX_OPTIONS): lock the hierarchy and
//   the person's row, re-read the current values, reject a stale form, write only changed columns,
//   rebuild employee_hierarchy when the manager moved, append one audit row with before/after.
//   A manager loop surfaces as HierarchyCycleError from rebuildHierarchy (the same cycle check the
//   import uses) and rolls the whole change back. Permission checks read the live structure, so a
//   committed manager change moves visibility immediately.

export const EMPLOYEE_PAGE_SIZE = 50;
export const AUDIT_ENTITY = "employee";
export const AUDIT_ACTION_UPDATE = "HR_UPDATE";

const MAX_QUERY_LENGTH = 100;
const MAX_QUERY_TERMS = 5;
const MAX_FILTER_LENGTH = 200;
const MAX_PAGE = 100_000;

export type EmployeeAdminDb = Pick<PrismaClient, "employee" | "$transaction">;

// ---------------------------------------------------------------------------
// List filters (URL search params - untrusted; an invalid value falls back to "no filter")
// ---------------------------------------------------------------------------

export const TRI_STATE_VALUES = ["all", "yes", "no"] as const;
export type TriState = (typeof TRI_STATE_VALUES)[number];

const firstValue = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);
const textParam = (max: number) => z.preprocess(firstValue, z.string().trim().max(max)).catch("");
const triStateParam = z.preprocess(firstValue, z.enum(TRI_STATE_VALUES)).catch("all");

const listFiltersSchema = z.object({
  q: textParam(MAX_QUERY_LENGTH),
  department: textParam(MAX_FILTER_LENGTH),
  manager: textParam(MAX_FILTER_LENGTH),
  active: triStateParam,
  whiteCollar: triStateParam,
  hrAdmin: triStateParam,
  page: z.preprocess(firstValue, z.coerce.number().int().min(1).max(MAX_PAGE)).catch(1),
});

export type EmployeeListFilters = z.output<typeof listFiltersSchema>;

export function parseEmployeeListFilters(raw: Record<string, unknown>): EmployeeListFilters {
  return listFiltersSchema.parse(raw);
}

const flag = (value: TriState): boolean | undefined => (value === "all" ? undefined : value === "yes");

/**
 * Every search word must match a name, AMEI or e-mail. Prisma's `contains` escapes LIKE wildcards
 * itself; if it ever did not, `_` / `%` would only widen the results of this read-only search.
 */
export function employeeListWhere(filters: EmployeeListFilters): Prisma.EmployeeWhereInput {
  const terms = filters.q.split(/\s+/).filter(Boolean).slice(0, MAX_QUERY_TERMS);
  const and: Prisma.EmployeeWhereInput[] = terms.map((term) => ({
    OR: [
      { firstName: { contains: term, mode: "insensitive" } },
      { lastName: { contains: term, mode: "insensitive" } },
      { amei: { contains: term, mode: "insensitive" } },
      { email: { contains: term, mode: "insensitive" } },
    ],
  }));
  if (filters.department) and.push({ department: filters.department });
  if (filters.manager) and.push({ manager: { amei: filters.manager.toUpperCase() } });
  const flags = { isActive: flag(filters.active), isWhiteCollar: flag(filters.whiteCollar), isHrAdmin: flag(filters.hrAdmin) };
  for (const [field, value] of Object.entries(flags)) {
    if (value !== undefined) and.push({ [field]: value });
  }
  return and.length === 0 ? {} : { AND: and };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const listSelect = {
  id: true,
  amei: true,
  email: true,
  firstName: true,
  lastName: true,
  department: true,
  position: true,
  location: true,
  isActive: true,
  isWhiteCollar: true,
  isHrAdmin: true,
  updatedAt: true,
  manager: { select: { amei: true, firstName: true, lastName: true } },
  validatorOverride: { select: { amei: true, firstName: true, lastName: true } },
} satisfies Prisma.EmployeeSelect;

export interface EmployeeListItem extends EditableEmployee {
  id: number;
  amei: string;
  email: string;
  firstName: string;
  lastName: string;
  isWhiteCollar: boolean;
  managerName: string | null;
  /** WF-09 override validator, shown next to the manager. */
  validatorOverrideName: string | null;
  /** updatedAt as ISO; sent back with an edit to detect a concurrent change. */
  version: string;
}

export interface EmployeeListPage {
  items: EmployeeListItem[];
  total: number;
  page: number;
  pageCount: number;
}

type ListRow = Prisma.EmployeeGetPayload<{ select: typeof listSelect }>;

function toListItem(row: ListRow): EmployeeListItem {
  const { manager, validatorOverride, updatedAt, ...rest } = row;
  return {
    ...rest,
    managerAmei: manager?.amei ?? null,
    managerName: manager ? `${manager.firstName} ${manager.lastName}` : null,
    validatorOverrideAmei: validatorOverride?.amei ?? null,
    validatorOverrideName: validatorOverride ? `${validatorOverride.firstName} ${validatorOverride.lastName}` : null,
    version: updatedAt.toISOString(),
  };
}

export async function listEmployees(
  db: EmployeeAdminDb,
  viewer: Viewer,
  filters: EmployeeListFilters,
): Promise<EmployeeListPage> {
  await requireActiveHrAdmin(db, viewer);
  const where = employeeListWhere(filters);
  const total = await db.employee.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / EMPLOYEE_PAGE_SIZE));
  // A page past the end (bookmarked URL, list shrank) shows the last page instead of nothing.
  const page = Math.min(filters.page, pageCount);
  const rows = await db.employee.findMany({
    where,
    select: listSelect,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }, { id: "asc" }],
    skip: (page - 1) * EMPLOYEE_PAGE_SIZE,
    take: EMPLOYEE_PAGE_SIZE,
  });
  return { items: rows.map(toListItem), total, page, pageCount };
}

export interface ManagerOption {
  amei: string;
  name: string;
}

export interface EmployeeFilterOptions {
  departments: string[];
  /** Active people, suggested in the manager inputs (any existing AMEI is still accepted). */
  managers: ManagerOption[];
}

export async function loadEmployeeFilterOptions(db: EmployeeAdminDb, viewer: Viewer): Promise<EmployeeFilterOptions> {
  await requireActiveHrAdmin(db, viewer);
  const [departments, managers] = await Promise.all([
    db.employee.findMany({
      where: { department: { not: null } },
      distinct: ["department"],
      select: { department: true },
      orderBy: { department: "asc" },
    }),
    db.employee.findMany({
      where: { isActive: true },
      select: { amei: true, firstName: true, lastName: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);
  return {
    departments: departments.flatMap((row) => (row.department === null ? [] : [row.department])),
    managers: managers.map((m) => ({ amei: m.amei, name: `${m.firstName} ${m.lastName}` })),
  };
}

// ---------------------------------------------------------------------------
// Edit (HR-04)
// ---------------------------------------------------------------------------

export class EmployeeAdminError extends Error {
  constructor(
    readonly code: EmployeeEditErrorCode,
    readonly fieldErrors: EmployeeEditFieldErrors = {},
  ) {
    super(`Employee edit: ${code}`);
    this.name = "EmployeeAdminError";
  }
}

export interface EmployeeUpdateResult {
  changes: EmployeeFieldChange[];
}

const editSelect = {
  id: true,
  managerId: true,
  department: true,
  position: true,
  location: true,
  isActive: true,
  isHrAdmin: true,
  updatedAt: true,
  manager: { select: { amei: true } },
  validatorOverrideId: true,
  validatorOverride: { select: { amei: true } },
} satisfies Prisma.EmployeeSelect;

type EditRow = Prisma.EmployeeGetPayload<{ select: typeof editSelect }>;

const editable = (row: EditRow): EditableEmployee => ({
  managerAmei: row.manager?.amei ?? null,
  validatorOverrideAmei: row.validatorOverride?.amei ?? null,
  department: row.department,
  position: row.position,
  location: row.location,
  isActive: row.isActive,
  isHrAdmin: row.isHrAdmin,
});

const auditValues = (changes: readonly EmployeeFieldChange[], side: "before" | "after") =>
  Object.fromEntries(changes.map((change) => [change.field, change[side]]));

/** A form field that names another person by AMEI, with its own error codes. */
interface PersonReference {
  field: "managerAmei" | "validatorOverrideAmei";
  unknown: EmployeeEditErrorCode;
  self: EmployeeEditErrorCode;
  /** Set when the person must be able to sign in (an override validator who cannot would block the document). */
  cannotSignIn?: EmployeeEditErrorCode;
}

const MANAGER_REFERENCE: PersonReference = { field: "managerAmei", unknown: "UNKNOWN_MANAGER", self: "SELF_MANAGER" };
const OVERRIDE_REFERENCE: PersonReference = {
  field: "validatorOverrideAmei",
  unknown: "UNKNOWN_VALIDATOR",
  self: "SELF_VALIDATOR",
  cannotSignIn: "INACTIVE_VALIDATOR",
};

const fail = (reference: PersonReference, code: EmployeeEditErrorCode): never => {
  throw new EmployeeAdminError(code, { [reference.field]: code });
};

/**
 * Resolves an AMEI from the form to an employee id. Unchanged when the AMEI is the current one, so
 * keeping an existing value never fails on rules added later.
 */
async function resolvePersonId(
  tx: Prisma.TransactionClient,
  employeeId: number,
  amei: string | null,
  current: { id: number | null; amei: string | null },
  reference: PersonReference,
): Promise<number | null> {
  if (amei === null) return null;
  if (amei === current.amei) return current.id;
  const person = await tx.employee.findUnique({
    where: { amei },
    select: { id: true, isActive: true, isWhiteCollar: true },
  });
  if (!person) return fail(reference, reference.unknown);
  if (person.id === employeeId) return fail(reference, reference.self);
  if (reference.cannotSignIn && !(person.isActive && person.isWhiteCollar)) return fail(reference, reference.cannotSignIn);
  return person.id;
}

/** Fields stored as foreign keys, not as columns of the same name. */
const PERSON_FIELDS: ReadonlySet<string> = new Set([MANAGER_REFERENCE.field, OVERRIDE_REFERENCE.field]);

/** Locks the person's row and reads it. Call after lockHierarchy. */
async function lockAndLoad(tx: Prisma.TransactionClient, employeeId: number): Promise<EditRow> {
  await tx.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId} FOR UPDATE`;
  const row = await tx.employee.findUnique({ where: { id: employeeId }, select: editSelect });
  if (!row) throw new EmployeeAdminError("NOT_FOUND");
  return row;
}

function assertNoSelfLockout(viewer: Viewer, employeeId: number, after: EditableEmployee): void {
  // Deactivating yourself or dropping your own HR flag would lock you out of this very screen.
  if (employeeId !== viewer.id) return;
  if (!after.isActive) throw new EmployeeAdminError("SELF_LOCKOUT", { isActive: "SELF_LOCKOUT" });
  if (!after.isHrAdmin) throw new EmployeeAdminError("SELF_LOCKOUT", { isHrAdmin: "SELF_LOCKOUT" });
}

/** HR edit of one person. Returns the changed fields; an empty list means nothing was written. */
export async function updateEmployee(
  db: EmployeeAdminDb,
  viewer: Viewer,
  input: unknown,
): Promise<EmployeeUpdateResult> {
  const parsed = employeeEditSchema.safeParse(input);
  if (!parsed.success) throw new EmployeeAdminError("INVALID_INPUT", employeeEditFieldErrors(parsed.error));
  const { employeeId, version, ...after } = parsed.data;
  assertNoSelfLockout(viewer, employeeId, after);

  try {
    return await db.$transaction(async (tx) => {
      // Lock first, THEN re-check HR: every structure change (this edit, the import) takes the same
      // lock, so two HR admins demoting each other are serialised and the second one is refused.
      await lockHierarchy(tx);
      await requireActiveHrAdmin(tx, viewer);
      const row = await lockAndLoad(tx, employeeId);
      if (row.updatedAt.toISOString() !== version) throw new EmployeeAdminError("STALE");

      const changes = employeeChanges(editable(row), after);
      if (changes.length === 0) return { changes };

      const currentManager = { id: row.managerId, amei: row.manager?.amei ?? null };
      const currentOverride = { id: row.validatorOverrideId, amei: row.validatorOverride?.amei ?? null };
      const managerId = await resolvePersonId(tx, row.id, after.managerAmei, currentManager, MANAGER_REFERENCE);
      const validatorOverrideId = await resolvePersonId(
        tx,
        row.id,
        after.validatorOverrideAmei,
        currentOverride,
        OVERRIDE_REFERENCE,
      );
      const managerMoved = managerId !== row.managerId;
      const overrideMoved = validatorOverrideId !== row.validatorOverrideId;
      const columns = changes.filter((c) => !PERSON_FIELDS.has(c.field)).map((c) => [c.field, c.after]);
      await tx.employee.update({
        where: { id: employeeId },
        data: {
          ...Object.fromEntries(columns),
          ...(managerMoved ? { managerId } : {}),
          // WF-09: no hierarchy rebuild - the override is read live by the permission module.
          ...(overrideMoved ? { validatorOverrideId } : {}),
        },
      });
      // Same transaction: a loop throws HierarchyCycleError here and nothing above is committed.
      if (managerMoved) await rebuildHierarchy(tx);
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: AUDIT_ENTITY,
        entityId: employeeId,
        action: AUDIT_ACTION_UPDATE,
        before: auditValues(changes, "before"),
        after: auditValues(changes, "after"),
      });
      return { changes };
    }, HIERARCHY_TX_OPTIONS);
  } catch (error: unknown) {
    if (error instanceof HierarchyCycleError) {
      throw new EmployeeAdminError("HIERARCHY_CYCLE", { managerAmei: "HIERARCHY_CYCLE" });
    }
    throw error;
  }
}
