import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { canValidatorEditGoals, goalEditScope, isDocumentStatus, type GoalEditScope } from "@/domain/document-status";
import { ForbiddenError, requireDocumentPermission, type Viewer } from "@/server/permissions";

// Shared by the goal writers of Parts 2 and 3 (performance-goals.ts, development-goals.ts): the
// document lock and permission check every goal write starts with (owner, or the validator for
// WF-04), and the @db.Date conversions.

type Tx = Prisma.TransactionClient;

export interface LockedGoalDocument {
  cycleId: number;
  cycleYear: number;
  /** WF-02 / WF-05 lock for the owner (document-status.ts); NONE when the cycle is not open. */
  editScope: GoalEditScope;
  /** editScope FULL: cycle OTWARTY and document SZKIC or ZWROCONY. The caller throws its own NOT_EDITABLE. */
  isEditable: boolean;
  /** Has gone to validation at least once (a returned document counts as sent). */
  wasSent: boolean;
}

interface LockedDocumentRow {
  documentStatus: string;
  cycleStatus: string;
  cycleId: number;
  cycleYear: number;
}

/** True once the document has been sent to validation (G2-25: delete before, cancel after). */
export async function wasDocumentSent(
  db: Pick<Prisma.TransactionClient, "documentStatusHistory">,
  documentId: number,
): Promise<boolean> {
  return (await db.documentStatusHistory.count({ where: { documentId, toStatus: "DO_WALIDACJI" } })) > 0;
}

/**
 * Locks the document FOR UPDATE and its cycle FOR SHARE: a concurrent send, approve, return or
 * cycle close waits for this transaction.
 */
async function lockDocumentRow(tx: Tx, documentId: number): Promise<LockedDocumentRow | undefined> {
  // documentId is a validated int4; $queryRaw binds it as a parameter.
  const [locked] = await tx.$queryRaw<LockedDocumentRow[]>`
    SELECT d.status::text AS "documentStatus", c.status::text AS "cycleStatus", c.id AS "cycleId", c.year AS "cycleYear"
    FROM gedp_document d JOIN cycle c ON c.id = d.cycle_id
    WHERE d.id = ${documentId}
    FOR UPDATE OF d FOR SHARE OF c`;
  return locked;
}

/**
 * Inside a write transaction: locks the document (lockDocumentRow), then checks permission: edit,
 * owner only. NotFoundError / ForbiddenError as in the permission module; editability is returned,
 * not thrown.
 */
export async function lockOwnGoalDocument(tx: Tx, viewer: Viewer, documentId: number): Promise<LockedGoalDocument> {
  const locked = await lockDocumentRow(tx, documentId);
  // Missing documents fall through to the permission check, which reports them as not found.
  const access = await requireDocumentPermission(tx, viewer, documentId, "edit");
  if (access.employeeId !== viewer.id) throw new ForbiddenError("edit", `document ${documentId}: owner only`);
  if (!locked) return { cycleId: access.cycleId, cycleYear: 0, editScope: "NONE", isEditable: false, wasSent: false };

  const editScope = isDocumentStatus(locked.documentStatus)
    ? goalEditScope(locked.documentStatus, locked.cycleStatus === "OTWARTY")
    : "NONE";
  return {
    cycleId: locked.cycleId,
    cycleYear: locked.cycleYear,
    editScope,
    isEditable: editScope === "FULL",
    wasSent: await wasDocumentSent(tx, documentId),
  };
}

/** WF-04 audit action of a goal the validator changed during validation (Parts 2 and 3). */
export const MANAGER_UPDATE_AUDIT_ACTION = "UPDATE_BY_MANAGER";

export interface ValidatorLockedGoalDocument {
  cycleId: number;
  cycleYear: number;
  /** WF-04: cycle OTWARTY and document DO_WALIDACJI. The caller throws its own NOT_EDITABLE. */
  isEditable: boolean;
}

/**
 * WF-04, inside a write transaction: locks the document (lockDocumentRow), then checks permission:
 * validate - the live N+1 or the WF-09 override, never the owner, N+2 or HR as such. Who validates
 * is decided by the permission module, as for "Zatwierdź" / "Zwróć do poprawy".
 */
export async function lockValidatorGoalDocument(
  tx: Tx,
  viewer: Viewer,
  documentId: number,
): Promise<ValidatorLockedGoalDocument> {
  const locked = await lockDocumentRow(tx, documentId);
  // Missing documents fall through to the permission check, which reports them as not found.
  const access = await requireDocumentPermission(tx, viewer, documentId, "validate");
  if (!locked) return { cycleId: access.cycleId, cycleYear: 0, isEditable: false };
  return {
    cycleId: locked.cycleId,
    cycleYear: locked.cycleYear,
    isEditable:
      isDocumentStatus(locked.documentStatus) &&
      canValidatorEditGoals(locked.documentStatus, locked.cycleStatus === "OTWARTY"),
  };
}

// @db.Date values travel as UTC midnight.
export const toIsoDate = (date: Date | null): string | null => (date ? date.toISOString().slice(0, 10) : null);
export const fromIsoDate = (date: string | null): Date | null => (date ? new Date(`${date}T00:00:00.000Z`) : null);
