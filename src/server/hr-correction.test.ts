import { describe, expect, it } from "vitest";
import {
  A,
  createFakeDb,
  DOC_A,
  HR,
  M1,
  rejection,
  seed,
  untouchable,
  viewer,
} from "../../tests/setup/workflow-fake-db";
import type { DocumentStatusValue } from "@/domain/document-status";
import {
  HR_CORRECTION_AUDIT_ACTION,
  HR_CORRECTION_REASON_MAX_LENGTH,
  parseHrCorrectionReason,
} from "@/domain/hr-correction";
import { correctDevelopmentGoalAsHr, DevelopmentGoalError } from "./development-goals";
import { correctBhpCommitmentAsHr, GroupGoalError } from "./group-goals";
import { correctPerformanceGoalAsHr, PerformanceGoalError } from "./performance-goals";
import { ForbiddenError, NotFoundError } from "./permissions";

// HR-07: HR corrects any document - every part, any status, any cycle - and every correction
// needs a reason that lands in the audit row with the before / after values. Against the
// in-memory fake client (tests/setup/workflow-fake-db.ts).

const REASON = "Typo reported by the employee on 3 March";
const STATUSES: readonly DocumentStatusValue[] = ["SZKIC", "DO_WALIDACJI", "ZWROCONY", "ZATWIERDZONY"];

const PLAN_PERFORMANCE_GOAL = {
  title: "Zero lost-time incidents",
  description: "No lost-time incident on line 2.",
  measures: "Incident register",
  dueDate: "2027-11-30",
  progress: "W_TRAKCIE",
  targetTypeId: 1,
  target: "Zero incidents",
  weight: 60,
};

const PLAN_DEVELOPMENT_GOAL = {
  competencyId: 400,
  developmentAreaId: 410,
  actionTitle: "Lead the line 2 retrospective",
  actionDescription: "Prepare and run the quarterly retrospective.",
  startDate: "2027-02-01",
  endDate: "2027-12-15",
  progress: "W_TRAKCIE",
};

function seededFake(status: DocumentStatusValue = "ZATWIERDZONY", cycleStatus = "OTWARTY") {
  const initial = seed(status);
  initial.cycle.status = cycleStatus;
  return createFakeDb(initial);
}

describe("[HR-07] the correction reason", () => {
  it("is trimmed, required and limited", () => {
    expect(parseHrCorrectionReason(`  ${REASON}  `)).toEqual({ ok: true, reason: REASON });
    expect(parseHrCorrectionReason("   ")).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(parseHrCorrectionReason(undefined)).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(parseHrCorrectionReason(42)).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(parseHrCorrectionReason("bad\u0000text")).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(parseHrCorrectionReason("x".repeat(HR_CORRECTION_REASON_MAX_LENGTH))).toMatchObject({ ok: true });
    expect(parseHrCorrectionReason("x".repeat(HR_CORRECTION_REASON_MAX_LENGTH + 1))).toEqual({
      ok: false,
      code: "REASON_TOO_LONG",
    });
  });

  it("is refused before any database call, in every part", async () => {
    const hr = viewer(HR);
    for (const reason of [undefined, "", "  "]) {
      await expect(
        correctPerformanceGoalAsHr(untouchable, hr, { goalId: 200, goal: PLAN_PERFORMANCE_GOAL, reason }),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED", status: 400 });
      await expect(
        correctDevelopmentGoalAsHr(untouchable, hr, { goalId: 300, goal: PLAN_DEVELOPMENT_GOAL, reason }),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
      await expect(
        correctBhpCommitmentAsHr(untouchable, hr, { documentId: DOC_A, templateId: 102, commitment: "x", reason }),
      ).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    }
    const tooLong = "x".repeat(HR_CORRECTION_REASON_MAX_LENGTH + 1);
    await expect(
      correctPerformanceGoalAsHr(untouchable, hr, { goalId: 200, goal: PLAN_PERFORMANCE_GOAL, reason: tooLong }),
    ).rejects.toMatchObject({ code: "REASON_TOO_LONG", status: 400 });
  });
});

describe("[HR-07] correctPerformanceGoalAsHr", () => {
  it("corrects an approved document in a closed cycle; state and N+1 flag stay, audit keeps before/after/reason", async () => {
    const fake = seededFake("ZATWIERDZONY", "ZAMKNIETY");
    const hr = viewer(HR);

    const corrected = await correctPerformanceGoalAsHr(fake.as(hr), hr, {
      goalId: 200,
      goal: PLAN_PERFORMANCE_GOAL,
      reason: `  ${REASON} `,
    });

    expect(corrected).toMatchObject({ id: 200, state: "W_PLANIE", title: PLAN_PERFORMANCE_GOAL.title, weight: 60 });
    const stored = fake.state.performanceGoals.find((g) => g.id === 200);
    expect(stored).toMatchObject({ state: "W_PLANIE", title: PLAN_PERFORMANCE_GOAL.title });
    expect(stored?.changedByManager).toBeUndefined();
    expect(fake.state.documents[0]?.status).toBe("ZATWIERDZONY");
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: HR,
        entity: "performance_goal",
        entityId: "200",
        action: HR_CORRECTION_AUDIT_ACTION,
        before: expect.objectContaining({ documentId: DOC_A, weight: 60, state: "W_PLANIE" }),
        after: expect.objectContaining({ documentId: DOC_A, title: PLAN_PERFORMANCE_GOAL.title, reason: REASON }),
      }),
    ]);
  });

  it.each(STATUSES)("works while the document is %s", async (status) => {
    const fake = seededFake(status);
    const hr = viewer(HR);
    await correctPerformanceGoalAsHr(fake.as(hr), hr, { goalId: 202, goal: { title: "Fixed title" }, reason: REASON });
    expect(fake.state.performanceGoals.find((g) => g.id === 202)).toMatchObject({ title: "Fixed title", state: "SZKIC" });
    expect(fake.state.audit).toHaveLength(1);
  });

  it("keeps the plan rules: a goal in the plan cannot lose a required field", async () => {
    const fake = seededFake();
    const hr = viewer(HR);
    const error = await rejection(
      correctPerformanceGoalAsHr(fake.as(hr), hr, {
        goalId: 200,
        goal: { ...PLAN_PERFORMANCE_GOAL, description: "" },
        reason: REASON,
      }),
    );
    expect(error).toBeInstanceOf(PerformanceGoalError);
    expect(error).toMatchObject({ code: "DESCRIPTION_REQUIRED", status: 400 });
    expect(fake.state.audit).toEqual([]);
  });

  it("writes nothing for an unchanged goal and refuses a cancelled one", async () => {
    const initial = seed("ZATWIERDZONY");
    initial.performanceGoals[1] = { ...initial.performanceGoals[1]!, state: "ANULOWANY" };
    const fake = createFakeDb(initial);
    const hr = viewer(HR);
    const input = { goalId: 202, goal: { title: "Same" }, reason: REASON };

    await correctPerformanceGoalAsHr(fake.as(hr), hr, input);
    await correctPerformanceGoalAsHr(fake.as(hr), hr, input);
    expect(fake.state.audit).toHaveLength(1);
    await expect(
      correctPerformanceGoalAsHr(fake.as(hr), hr, { goalId: 201, goal: PLAN_PERFORMANCE_GOAL, reason: REASON }),
    ).rejects.toMatchObject({ code: "GOAL_CANCELLED", status: 409 });
  });

  it("is HR only, checked against the live row: not the owner, not N+1, not a demoted HR", async () => {
    const input = { goalId: 202, goal: { title: "Hijack" }, reason: REASON };
    const fake = seededFake();
    await expect(correctPerformanceGoalAsHr(fake.as(viewer(A)), viewer(A), input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(correctPerformanceGoalAsHr(fake.as(viewer(M1)), viewer(M1), input)).rejects.toBeInstanceOf(ForbiddenError);

    const demoted = seed("ZATWIERDZONY");
    demoted.people = demoted.people.map((p) => (p.id === HR ? { ...p, isHrAdmin: false } : p));
    const demotedFake = createFakeDb(demoted);
    await expect(correctPerformanceGoalAsHr(demotedFake.as(viewer(HR)), viewer(HR), input)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(fake.state.audit).toEqual([]);
    expect(fake.state.performanceGoals.find((g) => g.id === 202)?.title).toBeUndefined();
  });

  it("reports a missing goal as not found", async () => {
    const fake = seededFake();
    await expect(
      correctPerformanceGoalAsHr(fake.as(viewer(HR)), viewer(HR), { goalId: 999, goal: { title: "x" }, reason: REASON }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("[HR-07] correctDevelopmentGoalAsHr", () => {
  it.each(STATUSES)("corrects a goal in the plan while the document is %s, audited with the reason", async (status) => {
    const fake = seededFake(status);
    const hr = viewer(HR);

    const corrected = await correctDevelopmentGoalAsHr(fake.as(hr), hr, {
      goalId: 300,
      goal: PLAN_DEVELOPMENT_GOAL,
      reason: REASON,
    });

    expect(corrected).toMatchObject({ id: 300, state: "W_PLANIE", actionTitle: PLAN_DEVELOPMENT_GOAL.actionTitle });
    expect(fake.state.developmentGoals.find((g) => g.id === 300)?.changedByManager).toBeUndefined();
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: HR,
        entity: "development_goal",
        entityId: "300",
        action: HR_CORRECTION_AUDIT_ACTION,
        before: expect.objectContaining({ documentId: DOC_A, state: "W_PLANIE" }),
        after: expect.objectContaining({ actionTitle: PLAN_DEVELOPMENT_GOAL.actionTitle, reason: REASON }),
      }),
    ]);
  });

  it("keeps the plan rules and is HR only", async () => {
    const fake = seededFake();
    const hr = viewer(HR);
    const error = await rejection(
      correctDevelopmentGoalAsHr(fake.as(hr), hr, {
        goalId: 300,
        goal: { ...PLAN_DEVELOPMENT_GOAL, actionDescription: null },
        reason: REASON,
      }),
    );
    expect(error).toBeInstanceOf(DevelopmentGoalError);
    expect(error).toMatchObject({ code: "ACTION_DESCRIPTION_REQUIRED" });

    await expect(
      correctDevelopmentGoalAsHr(fake.as(viewer(M1)), viewer(M1), {
        goalId: 300,
        goal: PLAN_DEVELOPMENT_GOAL,
        reason: REASON,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(fake.state.audit).toEqual([]);
  });
});

describe("[HR-07] correctBhpCommitmentAsHr", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    documentId: DOC_A,
    templateId: 102,
    commitment: "  Report every near miss within one shift  ",
    reason: REASON,
    ...overrides,
  });
  const ackOfA = (fake: ReturnType<typeof createFakeDb>) =>
    fake.state.acks.find((a) => a.documentId === DOC_A && a.templateId === 102);

  it.each(STATUSES)("corrects a saved commitment while the document is %s (closed cycle)", async (status) => {
    const fake = seededFake(status, "ZAMKNIETY");
    const hr = viewer(HR);
    const acknowledgedAt = ackOfA(fake)?.acknowledgedAt;

    const result = await correctBhpCommitmentAsHr(fake.as(hr), hr, input());

    // The acknowledgement date stays: it records when the employee committed.
    expect(result).toEqual({ templateId: 102, acknowledgedAt, commitment: "Report every near miss within one shift" });
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: HR,
        entity: "group_goal_ack",
        action: HR_CORRECTION_AUDIT_ACTION,
        before: expect.objectContaining({ hsCommitment: "Report every near miss" }),
        after: expect.objectContaining({ hsCommitment: "Report every near miss within one shift", reason: REASON }),
      }),
    ]);
  });

  it("never creates a commitment, and only for the BHP goal of the document's own cycle", async () => {
    const initial = seed("ZATWIERDZONY");
    initial.acks = initial.acks.map((a) =>
      a.templateId === 102 && a.documentId === DOC_A ? { ...a, hsCommitment: null } : a,
    );
    initial.templates.push({ id: 199, cycleId: 2, type: "BHP" });
    const fake = createFakeDb(initial);
    const hr = viewer(HR);

    const codeOf = async (promise: Promise<unknown>) => {
      const error = await rejection(promise);
      expect(error).toBeInstanceOf(GroupGoalError);
      return (error as GroupGoalError).code;
    };
    expect(await codeOf(correctBhpCommitmentAsHr(fake.as(hr), hr, input()))).toBe("NOT_ACKNOWLEDGED");
    expect(await codeOf(correctBhpCommitmentAsHr(fake.as(hr), hr, input({ templateId: 101 })))).toBe("WRONG_GOAL_TYPE");
    expect(await codeOf(correctBhpCommitmentAsHr(fake.as(hr), hr, input({ templateId: 199 })))).toBe("TEMPLATE_NOT_FOUND");
    expect(await codeOf(correctBhpCommitmentAsHr(fake.as(hr), hr, input({ commitment: " " })))).toBe("COMMITMENT_REQUIRED");
    expect(fake.state.audit).toEqual([]);
  });

  it("is HR only and reports a missing document as not found", async () => {
    const fake = seededFake();
    await expect(correctBhpCommitmentAsHr(fake.as(viewer(A)), viewer(A), input())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      correctBhpCommitmentAsHr(fake.as(viewer(HR)), viewer(HR), input({ documentId: 999 })),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ackOfA(fake)?.hsCommitment).toBe("Report every near miss");
  });
});
