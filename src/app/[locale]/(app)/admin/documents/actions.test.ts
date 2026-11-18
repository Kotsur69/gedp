import { beforeEach, describe, expect, it, vi } from "vitest";

const requireEmployee = vi.fn();
vi.mock("@/server/current-employee", () => ({ requireEmployee }));

const fakeDb = { marker: "db" };
vi.mock("@/server/db", () => ({ db: () => fakeDb }));

const refresh = vi.fn();
vi.mock("next/cache", () => ({ refresh }));

const revertDocumentStatus = vi.fn();
vi.mock("@/server/workflow", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/workflow")>()),
  revertDocumentStatus,
}));

const { revertDocumentStatusAction } = await import("./actions");
const { WorkflowError } = await import("@/server/workflow");
const { ForbiddenError } = await import("@/server/permissions");

const HR = { id: 1, firstName: "Hanna", lastName: "Kadrowa", isHrAdmin: true };
const EMPLOYEE = { id: 2, firstName: "Jan", lastName: "Testowy", isHrAdmin: false };
const INPUT = { documentId: 10, from: "ZATWIERDZONY", to: "SZKIC", reason: "Mistake" };

beforeEach(() => {
  requireEmployee.mockReset().mockResolvedValue(HR);
  revertDocumentStatus.mockReset().mockResolvedValue({ documentId: 10 });
  refresh.mockReset();
});

describe("[WF-08] revertDocumentStatusAction", () => {
  it("refuses a non-HR viewer without touching the database", async () => {
    requireEmployee.mockResolvedValue(EMPLOYEE);
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(revertDocumentStatus).not.toHaveBeenCalled();
  });

  it("passes the session viewer (never the payload) and refreshes the list", async () => {
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: true });
    expect(revertDocumentStatus).toHaveBeenCalledWith(fakeDb, HR, INPUT);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("returns workflow codes; a status that moved meanwhile also refreshes the list", async () => {
    revertDocumentStatus.mockRejectedValueOnce(new WorkflowError("REASON_REQUIRED"));
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: false, code: "REASON_REQUIRED" });
    expect(refresh).not.toHaveBeenCalled();

    revertDocumentStatus.mockRejectedValueOnce(new WorkflowError("STATUS_CHANGED"));
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: false, code: "STATUS_CHANGED" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("maps access errors to FORBIDDEN and hides unexpected errors behind FAILED", async () => {
    revertDocumentStatus.mockRejectedValueOnce(new ForbiddenError("edit"));
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: false, code: "FORBIDDEN" });

    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    revertDocumentStatus.mockRejectedValueOnce(Object.assign(new Error("secret reason text"), { code: "P2034" }));
    expect(await revertDocumentStatusAction(INPUT)).toEqual({ ok: false, code: "FAILED" });
    expect(log).toHaveBeenCalledWith("[admin/documents] revert failed: Error (P2034)");
    log.mockRestore();
  });
});
