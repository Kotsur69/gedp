import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentEmployee } from "@/server/access";

// The ONLY place that decides who may see, edit or validate whose data (plan sections 3 and 6,
// ACC-10..13). Pages, server actions, exports and reports call these functions; none of them
// re-implements a rule. Everything is evaluated against the LIVE structure (employee.managerId,
// employee.validatorOverrideId, employee_hierarchy) - never against gedp_document.validatorId,
// which is a workflow snapshot - so a manager change flips access immediately.
//
// Rules:
//   employee        - own data only                                   (ACC-10)
//   N+1             - own + direct reports; validates them            (ACC-11)
//   N+2 and above   - own + whole subtree, VIEW ONLY                  (ACC-12, assumption until Q-05)
//   validator override (employee.validatorOverrideId, WF-09)
//                   - views and validates that one person, IN ADDITION to the manager
//   HR admin        - views and edits everything                      (ACC-13)
//   inactive / non-White-Collar subjects stay visible to their managers and HR (ACC-04: their
//   documents are kept); the access gate already keeps such people from signing in.
//
// Assumption (Q-05): HR does not validate unless HR is the person's manager or override validator;
// HR corrects statuses through the dedicated revert flow (WF-08), not by approving.
// This module answers "who". "When" (e.g. no edits while DO_WALIDACJI) is the workflow module's job.
//
// Contract for callers:
// - `viewer` must come from requireEmployee() in the same request; never build it from input.
// - A check is a snapshot. For writes, pass the transaction client and re-assert the rule in the
//   write itself (e.g. `where: { AND: [{ id }, validatableDocumentsWhere(viewer)] }` + count === 1),
//   so a manager change committed between check and write cannot slip through.
// - List queries use scopedEmployeesWhere / scopedDocumentsWhere; never spread a scope object.

export type Viewer = Pick<CurrentEmployee, "id" | "isHrAdmin">;

export type DocumentAction = "view" | "edit" | "validate";

export interface Permissions {
  readonly view: boolean;
  readonly edit: boolean;
  readonly validate: boolean;
}

/** The person whose data is being accessed, as far as access rules care. */
export interface AccessSubject {
  employeeId: number;
  managerId: number | null;
  validatorOverrideId: number | null;
}

const NONE: Permissions = Object.freeze({ view: false, edit: false, validate: false });

// employee.id / gedp_document.id are Postgres int4; larger values would make Prisma throw (500)
// where an existing-but-invisible id gives 404 - so out-of-range ids are treated as "not found".
const MAX_INT4 = 2_147_483_647;
const isDbId = (id: number): boolean => Number.isSafeInteger(id) && id >= 1 && id <= MAX_INT4;

/**
 * Pure rule table. `viewerIsAncestor` = the subject is anywhere below the viewer in the
 * structure (depth >= 1). Callers holding rows should use permissionsFromRow instead.
 */
export function decidePermissions(viewer: Viewer, subject: AccessSubject, viewerIsAncestor: boolean): Permissions {
  const isSelf = viewer.id === subject.employeeId;
  // Nobody validates their own document, even if misconfigured as their own override.
  // managerId is checked directly (not only via the closure), so N+1 rights never lag a rebuild.
  const isValidator =
    !isSelf && (subject.managerId === viewer.id || subject.validatorOverrideId === viewer.id);
  return {
    view: viewer.isHrAdmin || isSelf || viewerIsAncestor || isValidator,
    edit: viewer.isHrAdmin || isSelf,
    validate: isValidator,
  };
}

/**
 * Prisma `select` for an employee row that permissionsFromRow can evaluate without another query.
 * `ancestors` = closure rows where THIS employee is the descendant; filtered to the viewer.
 */
export function accessSubjectSelect(viewer: Viewer) {
  return {
    id: true,
    managerId: true,
    validatorOverrideId: true,
    ancestors: { where: { ancestorId: viewer.id, depth: { gte: 1 } }, select: { depth: true }, take: 1 },
  } satisfies Prisma.EmployeeSelect;
}

export interface AccessSubjectRow {
  id: number;
  managerId: number | null;
  validatorOverrideId: number | null;
  ancestors: readonly { depth: number }[];
}

/** Permissions for a row loaded with accessSubjectSelect(viewer) - for lists, exports, reports. */
export function permissionsFromRow(viewer: Viewer, row: AccessSubjectRow): Permissions {
  return decidePermissions(
    viewer,
    { employeeId: row.id, managerId: row.managerId, validatorOverrideId: row.validatorOverrideId },
    row.ancestors.length > 0,
  );
}

export type AccessErrorCode = "NOT_FOUND" | "FORBIDDEN";

/** Target missing OR invisible to the viewer (never reveal which). Pages: notFound(). */
export class NotFoundError extends Error {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404 as const;
  constructor(readonly detail?: string) {
    super("Not found");
    this.name = "NotFoundError";
  }
}

/** Target visible but the action is not allowed. */
export class ForbiddenError extends Error {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403 as const;
  constructor(
    readonly action: DocumentAction,
    readonly detail?: string,
  ) {
    super(`Forbidden: ${action}`);
    this.name = "ForbiddenError";
  }
}

/**
 * Next.js strips error details from server actions, so callers map with this: pages call
 * notFound() / forbidden(), actions return `{ ok: false, code }`.
 */
export function isAccessError(error: unknown): error is NotFoundError | ForbiddenError {
  return error instanceof NotFoundError || error instanceof ForbiddenError;
}

/** Root client or a transaction client; pass `tx` when the check must share the write's snapshot. */
export type PermissionReader = Pick<Prisma.TransactionClient, "employee" | "gedpDocument">;

export async function permissionsForEmployee(
  db: PermissionReader,
  viewer: Viewer,
  employeeId: number,
): Promise<Permissions> {
  if (!isDbId(employeeId)) return NONE;
  const row = await db.employee.findUnique({ where: { id: employeeId }, select: accessSubjectSelect(viewer) });
  return row ? permissionsFromRow(viewer, row) : NONE;
}

export interface DocumentAccess {
  documentId: number;
  employeeId: number;
  cycleId: number;
  status: Prisma.GedpDocumentGetPayload<{ select: { status: true } }>["status"];
  permissions: Permissions;
}

async function loadDocumentAccess(db: PermissionReader, viewer: Viewer, documentId: number): Promise<DocumentAccess | null> {
  if (!isDbId(documentId)) return null;
  const doc = await db.gedpDocument.findUnique({
    where: { id: documentId },
    select: { id: true, cycleId: true, status: true, employee: { select: accessSubjectSelect(viewer) } },
  });
  if (!doc) return null;
  return {
    documentId: doc.id,
    employeeId: doc.employee.id,
    cycleId: doc.cycleId,
    status: doc.status,
    permissions: permissionsFromRow(viewer, doc.employee),
  };
}

/**
 * Guard for server actions and route handlers (one query). Throws NotFoundError when the document
 * is missing, out of range or invisible to the viewer - so a hand-edited id reveals nothing - and
 * ForbiddenError when it is visible but the action is not allowed.
 */
export async function requireDocumentPermission(
  db: PermissionReader,
  viewer: Viewer,
  documentId: number,
  action: DocumentAction,
): Promise<DocumentAccess> {
  const access = await loadDocumentAccess(db, viewer, documentId);
  if (!access?.permissions.view) throw new NotFoundError(`document ${documentId}`);
  if (!access.permissions[action]) throw new ForbiddenError(action, `document ${documentId}`);
  return access;
}

/** Same guard for an employee's data (profile, HR screens). */
export async function requireEmployeePermission(
  db: PermissionReader,
  viewer: Viewer,
  employeeId: number,
  action: DocumentAction,
): Promise<Permissions> {
  const permissions = await permissionsForEmployee(db, viewer, employeeId);
  if (!permissions.view) throw new NotFoundError(`employee ${employeeId}`);
  if (!permissions[action]) throw new ForbiddenError(action, `employee ${employeeId}`);
  return permissions;
}

export async function canViewEmployee(db: PermissionReader, viewer: Viewer, employeeId: number): Promise<boolean> {
  return (await permissionsForEmployee(db, viewer, employeeId)).view;
}

export async function canEditDocument(db: PermissionReader, viewer: Viewer, documentId: number): Promise<boolean> {
  return (await loadDocumentAccess(db, viewer, documentId))?.permissions.edit ?? false;
}

export async function canValidateDocument(db: PermissionReader, viewer: Viewer, documentId: number): Promise<boolean> {
  return (await loadDocumentAccess(db, viewer, documentId))?.permissions.validate ?? false;
}

// --- List scopes. Raw scope objects stay private: spreading one next to a caller's own `OR` or
// `employee` key would silently replace it. The exported builders always AND the scope in.

function employeeScope(viewer: Viewer): Prisma.EmployeeWhereInput {
  if (viewer.isHrAdmin) return {};
  return {
    OR: [
      { id: viewer.id },
      // `ancestors` = closure rows where this employee is the descendant.
      { ancestors: { some: { ancestorId: viewer.id, depth: { gte: 1 } } } },
      // Also covered by the closure (depth 1); kept so N+1 never depends on a rebuild.
      { managerId: viewer.id },
      { validatorOverrideId: viewer.id },
    ],
  };
}

/** Employees the viewer may see, combined with the caller's own filter. Mirrors `view`. */
export function scopedEmployeesWhere(viewer: Viewer, where: Prisma.EmployeeWhereInput = {}): Prisma.EmployeeWhereInput {
  return { AND: [employeeScope(viewer), where] };
}

/** Documents the viewer may see, combined with the caller's own filter. */
export function scopedDocumentsWhere(
  viewer: Viewer,
  where: Prisma.GedpDocumentWhereInput = {},
): Prisma.GedpDocumentWhereInput {
  return { AND: [{ employee: employeeScope(viewer) }, where] };
}

/**
 * Documents the viewer may validate (live rule, mirrors `validate`). Use it for the "to validate"
 * inbox AND inside workflow writes, so the check and the write cannot disagree.
 */
export function validatableDocumentsWhere(
  viewer: Viewer,
  where: Prisma.GedpDocumentWhereInput = {},
): Prisma.GedpDocumentWhereInput {
  return {
    AND: [
      { employeeId: { not: viewer.id } },
      { employee: { OR: [{ managerId: viewer.id }, { validatorOverrideId: viewer.id }] } },
      where,
    ],
  };
}
