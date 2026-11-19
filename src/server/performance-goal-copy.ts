import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { moveToYear, parseIsoDate, toIsoDate } from "@/domain/calendar-date";
import { DEFAULT_TARGET_TYPE_CODE } from "@/domain/performance-goal";
import { writeAudit } from "@/server/audit";
import { fromIsoDate, lockOwnGoalDocument, toIsoDate as dbDateToIso } from "@/server/goal-document";
import {
  auditRecord,
  goalSelect,
  MAX_GOALS_PER_DOCUMENT,
  PerformanceGoalError,
  toView,
  type PerformanceGoalView,
  type PerformanceGoalWriter,
} from "@/server/performance-goals";
import type { Viewer } from "@/server/permissions";

// G2-06: "kopiuj" next to "+" copies the person's performance goals of the previous cycle year
// into the current document as drafts. Same guarantees as every goal write (performance-goals.ts):
// document locked, owner only, cycle open and document not with the validator, one audit row per
// created goal, all in one transaction.
//
// What a copy keeps and resets [ZAŁ - eGEDP does not show the copied goal]:
// - kept: title, description, measures, target, weight, target type (the type with the same code in
//   the new cycle; falls back to "Tekst" when that cycle lacks it or HR has deactivated it; a target
//   is valid text for "Tekst", so the draft stays valid);
// - reset: state SZKIC, progress "Do rozpoczęcia", the N+1 marker;
// - due date: same day and month in the new year (29 Feb -> 28 Feb), so it lies inside the cycle.
// Cancelled goals are not copied. Copying twice creates the goals twice: the window says how many
// goals will be added before the person confirms.

const MAX_INT4 = 2_147_483_647;
export const copyGoalsInputSchema = z.object({ documentId: z.number().int().min(1).max(MAX_INT4) }).strict();

const previousYearGoals = (employeeId: number, cycleYear: number) =>
  ({
    document: { employeeId, cycle: { year: cycleYear - 1 } },
    state: { not: "ANULOWANY" },
  }) satisfies Prisma.PerformanceGoalWhereInput;

export interface CopyableGoals {
  previousYear: number;
  count: number;
}

/** How many of the viewer's goals from the year before `cycleYear` a copy would add. */
export async function countCopyableGoals(
  db: Pick<PrismaClient, "performanceGoal">,
  viewer: Viewer,
  cycleYear: number,
): Promise<CopyableGoals> {
  const count = await db.performanceGoal.count({ where: previousYearGoals(viewer.id, cycleYear) });
  return { previousYear: cycleYear - 1, count };
}

/** Due date moved into `cycleYear`; null stays null. */
export function copiedDueDate(dueDate: Date | null, cycleYear: number): Date | null {
  const iso = dbDateToIso(dueDate);
  const day = iso === null ? null : parseIsoDate(iso);
  return day === null ? null : fromIsoDate(toIsoDate(moveToYear(day, cycleYear)));
}

/** Copies last year's goals into `documentId`; returns the created drafts in their original order. */
export async function copyPerformanceGoalsFromPreviousYear(
  db: PerformanceGoalWriter,
  viewer: Viewer,
  input: unknown,
): Promise<PerformanceGoalView[]> {
  const parsed = copyGoalsInputSchema.safeParse(input);
  if (!parsed.success) throw new PerformanceGoalError("INVALID_INPUT");
  const { documentId } = parsed.data;

  return db.$transaction(async (tx) => {
    const document = await lockOwnGoalDocument(tx, viewer, documentId);
    if (!document.isEditable) throw new PerformanceGoalError("NOT_EDITABLE");

    const sources = await tx.performanceGoal.findMany({
      where: previousYearGoals(viewer.id, document.cycleYear),
      select: goalSelect,
      orderBy: { id: "asc" },
    });
    if (sources.length === 0) throw new PerformanceGoalError("NOTHING_TO_COPY");
    const existing = await tx.performanceGoal.count({ where: { documentId } });
    if (existing + sources.length > MAX_GOALS_PER_DOCUMENT) throw new PerformanceGoalError("TOO_MANY_GOALS");

    // HR-05: each cycle has its own target type list, so a source type is matched by code in the
    // new cycle; a code that is missing or inactive there falls back to the default "Tekst".
    const types = await tx.targetType.findMany({
      where: { cycleId: document.cycleId, OR: [{ isActive: true }, { code: DEFAULT_TARGET_TYPE_CODE }] },
      select: { id: true, code: true, isActive: true },
    });
    const fallbackTypeId = types.find((type) => type.code === DEFAULT_TARGET_TYPE_CODE)?.id;
    if (fallbackTypeId === undefined) throw new PerformanceGoalError("DEFAULT_TARGET_TYPE_MISSING");
    const activeTypeIdByCode = new Map(types.filter((type) => type.isActive).map((type) => [type.code, type.id]));

    const created: PerformanceGoalView[] = [];
    for (const source of sources) {
      const ownTypeId = source.targetType ? activeTypeIdByCode.get(source.targetType.code) : undefined;
      const row = await tx.performanceGoal.create({
        data: {
          documentId,
          title: source.title,
          description: source.description,
          measures: source.measures,
          dueDate: copiedDueDate(source.dueDate, document.cycleYear),
          progress: 0,
          targetTypeId: ownTypeId ?? fallbackTypeId,
          targetValue: source.targetValue,
          weight: source.weight,
          state: "SZKIC",
        },
        select: goalSelect,
      });
      const goal = toView(row);
      await writeAudit(tx, {
        actorId: viewer.id,
        entity: "performance_goal",
        entityId: goal.id,
        action: "COPY",
        after: auditRecord(goal),
      });
      created.push(goal);
    }
    return created;
  });
}
