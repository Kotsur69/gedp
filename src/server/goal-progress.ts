import "server-only";
import { z } from "zod";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { GOAL_PROGRESS_VALUES, progressFromPercent, progressToPercent, type GoalProgress } from "@/domain/performance-goal";
import { writeAudit } from "@/server/audit";
import { lockOwnGoalDocument } from "@/server/goal-document";
import { NotFoundError, type Viewer } from "@/server/permissions";
import { dbIdSchema, parseWorkflowInput, WorkflowError } from "@/server/workflow";

// WF-05 [ZAŁ Q-13]: once the document is approved the owner may still move a goal's progress
// (Do rozpoczęcia / W trakcie / Ukończony) during the year - nothing else. The other goal writers
// refuse an approved document (goal-document.ts editScope), so this is the only write left open.
// Same transaction shape as every goal write: lock the document, owner only, re-read the goal
// under the lock, write, audit.

export const GOAL_PARTS = ["PERFORMANCE", "DEVELOPMENT"] as const;
export type GoalPart = (typeof GOAL_PARTS)[number];

export const goalProgressInputSchema = z
  .object({ part: z.enum(GOAL_PARTS), goalId: dbIdSchema, progress: z.enum(GOAL_PROGRESS_VALUES) })
  .strict();

const ENTITY: Readonly<Record<GoalPart, string>> = {
  PERFORMANCE: "performance_goal",
  DEVELOPMENT: "development_goal",
};

type Tx = Prisma.TransactionClient;
export type GoalProgressWriter = Pick<PrismaClient, "$transaction">;

interface ProgressRow {
  documentId: number;
  state: string;
  progress: number;
}

interface GoalKey {
  id: number;
  documentId?: number;
}

async function findGoal(tx: Tx, part: GoalPart, where: GoalKey): Promise<ProgressRow | null> {
  const select = { documentId: true, state: true, progress: true } as const;
  return part === "PERFORMANCE"
    ? tx.performanceGoal.findFirst({ where, select })
    : tx.developmentGoal.findFirst({ where, select });
}

async function writeProgress(tx: Tx, part: GoalPart, goalId: number, percent: number): Promise<void> {
  const data = { progress: percent };
  if (part === "PERFORMANCE") await tx.performanceGoal.update({ where: { id: goalId }, data });
  else await tx.developmentGoal.update({ where: { id: goalId }, data });
}

export interface GoalProgressResult {
  goalId: number;
  progress: GoalProgress;
}

/** Owner's progress update on an approved document in an open cycle; only goals in the plan. */
export async function updateGoalProgress(db: GoalProgressWriter, viewer: Viewer, input: unknown): Promise<GoalProgressResult> {
  const { part, goalId, progress } = parseWorkflowInput(goalProgressInputSchema, input);

  return db.$transaction(async (tx) => {
    const owner = await findGoal(tx, part, { id: goalId });
    if (!owner) throw new NotFoundError(`${ENTITY[part]} ${goalId}`);
    const document = await lockOwnGoalDocument(tx, viewer, owner.documentId);
    // Editable documents change progress through the goal form; this path is the approved one only.
    if (document.editScope !== "PROGRESS_ONLY") throw new WorkflowError("NOT_EDITABLE");

    // Pinned to the locked document: a goal deleted since the first read is not found.
    const row = await findGoal(tx, part, { id: goalId, documentId: owner.documentId });
    if (!row) throw new NotFoundError(`${ENTITY[part]} ${goalId}`);
    if (row.state !== "W_PLANIE") throw new WorkflowError("GOAL_NOT_IN_PLAN");

    const before = progressFromPercent(row.progress);
    // Unchanged: no write and no audit row.
    if (before === progress) return { goalId, progress };

    await writeProgress(tx, part, goalId, progressToPercent(progress, row.progress));
    await writeAudit(tx, {
      actorId: viewer.id,
      entity: ENTITY[part],
      entityId: goalId,
      action: "UPDATE_PROGRESS",
      before: { documentId: row.documentId, progress: before },
      after: { documentId: row.documentId, progress },
    });
    return { goalId, progress };
  });
}
