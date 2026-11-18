import { beforeEach, describe, expect, it, vi } from "vitest";

const requireEmployee = vi.fn();
vi.mock("@/server/current-employee", () => ({ requireEmployee }));

const fakeDb = { marker: "db" };
vi.mock("@/server/db", () => ({ db: () => fakeDb }));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));

const correctBhpCommitmentAsHr = vi.fn();
vi.mock("@/server/group-goals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/group-goals")>()),
  correctBhpCommitmentAsHr,
}));

const { correctBhpCommitmentAction } = await import("./actions");
const { GroupGoalError } = await import("@/server/group-goals");
const { ForbiddenError } = await import("@/server/permissions");

const HR = { id: 1, firstName: "Hanna", lastName: "Kadrowa", isHrAdmin: true };
const EMPLOYEE = { id: 2, firstName: "Jan", lastName: "Testowy", isHrAdmin: false };
const INPUT = { documentId: 10, templateId: 102, commitment: "Report near misses", reason: "Typo" };

beforeEach(() => {
  requireEmployee.mockReset().mockResolvedValue(HR);
  correctBhpCommitmentAsHr.mockReset().mockResolvedValue({ templateId: 102 });
  refresh.mockReset();
});

describe("[HR-07] correctBhpCommitmentAction", () => {
  it("refuses a non-HR viewer without touching the database", async () => {
    requireEmployee.mockResolvedValue(EMPLOYEE);
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(correctBhpCommitmentAsHr).not.toHaveBeenCalled();
  });

  it("passes the session viewer (never the payload) and refreshes the page", async () => {
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: true });
    expect(correctBhpCommitmentAsHr).toHaveBeenCalledWith(fakeDb, HR, INPUT);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns domain codes without refreshing, so the window stays open with the message", async () => {
    correctBhpCommitmentAsHr.mockRejectedValueOnce(new GroupGoalError("REASON_REQUIRED"));
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(refresh).not.toHaveBeenCalled();

    correctBhpCommitmentAsHr.mockRejectedValueOnce(new GroupGoalError("NOT_ACKNOWLEDGED"));
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: false, code: "NOT_ACKNOWLEDGED" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("maps access errors to FORBIDDEN and hides unexpected errors behind FAILED", async () => {
    correctBhpCommitmentAsHr.mockRejectedValueOnce(new ForbiddenError("edit"));
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: false, code: "FORBIDDEN" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    correctBhpCommitmentAsHr.mockRejectedValueOnce(Object.assign(new Error("secret reason text"), { code: "P2034" }));
    expect(await correctBhpCommitmentAction(INPUT)).toEqual({ ok: false, code: "FAILED" });
    expect(log).toHaveBeenCalledWith("[admin/documents] BHP correction failed: Error (P2034)");
    log.mockRestore();
  });
});
