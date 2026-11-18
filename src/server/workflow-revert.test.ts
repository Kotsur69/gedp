import { describe, expect, it } from "vitest";
import {
  A,
  B,
  createFakeDb,
  DOC_A,
  DOC_B,
  expectWorkflowError,
  HR,
  M1,
  N2,
  OV,
  rejection,
  seed,
  untouchable,
  viewer,
} from "../../tests/setup/workflow-fake-db";
import { ForbiddenError, NotFoundError } from "./permissions";
import { AUDIT_ACTION_REVERT, loadDocumentWorkflow, revertDocumentStatus, transitionDocument } from "./workflow";

// WF-08 (HR reverts a document's status with a reason) and WF-09 (the HR-set override validator
// validates someone without a manager), against the in-memory fake client.

const REASON = "Approved by mistake - goals belong to the 2026 plan";
const revert = (overrides: Record<string, unknown> = {}) => ({
  documentId: DOC_A,
  from: "ZATWIERDZONY",
  to: "SZKIC",
  reason: REASON,
  ...overrides,
});

describe("[WF-08] revertDocumentStatus - HR moves a document back", () => {
  it("ZATWIERDZONY -> SZKIC writes the status, a history row with the reason and an audit row", async () => {
    const initial = seed("ZATWIERDZONY");
    initial.documents[0]!.validatorId = M1;
    const fake = createFakeDb(initial);

    const result = await revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert({ reason: `  ${REASON}  ` }));

    expect(result).toMatchObject({ documentId: DOC_A, from: "ZATWIERDZONY", to: "SZKIC" });
    // validatorId keeps recording who last validated; goals are not touched.
    expect(fake.state.documents[0]).toMatchObject({ status: "SZKIC", validatorId: M1 });
    expect(fake.state.performanceGoals).toEqual(initial.performanceGoals);
    expect(fake.state.history).toEqual([
      expect.objectContaining({ documentId: DOC_A, fromStatus: "ZATWIERDZONY", toStatus: "SZKIC", authorId: HR, comment: REASON }),
    ]);
    expect(fake.state.audit).toEqual([
      expect.objectContaining({
        actorId: HR,
        entity: "gedp_document",
        entityId: String(DOC_A),
        action: AUDIT_ACTION_REVERT,
        before: { status: "ZATWIERDZONY" },
        after: { status: "SZKIC", reason: REASON, historyId: result.historyId },
      }),
    ]);
  });

  it("every earlier status is reachable, also from validation and from a returned document", async () => {
    const cases = [
      ["ZATWIERDZONY", "DO_WALIDACJI"],
      ["ZATWIERDZONY", "ZWROCONY"],
      ["DO_WALIDACJI", "ZWROCONY"],
      ["DO_WALIDACJI", "SZKIC"],
      ["ZWROCONY", "SZKIC"],
    ] as const;
    for (const [from, to] of cases) {
      const fake = createFakeDb(seed(from));
      await revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert({ from, to }));
      expect(fake.state.documents[0]?.status, `${from} -> ${to}`).toBe(to);
    }
  });

  it("after a revert to DO_WALIDACJI the validator decides again, and everyone sees the reason in the history", async () => {
    const fake = createFakeDb(seed("ZATWIERDZONY"));
    await revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert({ to: "DO_WALIDACJI" }));

    const ownerView = await loadDocumentWorkflow(fake.as(viewer(A)), viewer(A), DOC_A, "OTWARTY");
    expect(ownerView.history).toEqual([
      expect.objectContaining({ fromStatus: "ZATWIERDZONY", toStatus: "DO_WALIDACJI", authorName: `Test P${HR}`, comment: REASON }),
    ]);
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" });
    expect(fake.state.documents[0]?.status).toBe("ZATWIERDZONY");
    expect(fake.state.audit.map((row) => row.action)).toEqual([AUDIT_ACTION_REVERT, "STATUS_APPROVE"]);
  });
});

describe("[WF-08] revertDocumentStatus - refusals leave no trace", () => {
  it("the reason is required: missing, null or blank is refused before the database (400)", async () => {
    for (const reason of [undefined, null, "", "   \n "]) {
      await expectWorkflowError(revertDocumentStatus(untouchable, viewer(HR), revert({ reason })), "REASON_REQUIRED", 400);
    }
    await expectWorkflowError(
      revertDocumentStatus(untouchable, viewer(HR), revert({ reason: "x".repeat(2001) })),
      "COMMENT_TOO_LONG",
      400,
    );
  });

  it("only backwards: a forward or same-status move is refused before the database (409)", async () => {
    const forward = [
      { from: "SZKIC", to: "DO_WALIDACJI" },
      { from: "DO_WALIDACJI", to: "ZATWIERDZONY" },
      { from: "ZATWIERDZONY", to: "ZATWIERDZONY" },
      { from: "SZKIC", to: "SZKIC" },
    ];
    for (const move of forward) {
      await expectWorkflowError(revertDocumentStatus(untouchable, viewer(HR), revert(move)), "ILLEGAL_TRANSITION", 409);
    }
  });

  it("refuses a malformed payload", async () => {
    const bad = [revert({ to: "DONE" }), revert({ documentId: "10" }), revert({ status: "SZKIC" }), { ...revert(), from: undefined }, null];
    for (const input of bad) {
      await expectWorkflowError(revertDocumentStatus(untouchable, viewer(HR), input), "INVALID_INPUT", 400);
    }
  });

  it("non-HR is refused whatever the payload: owner, N+1, N+2, override validator", async () => {
    for (const id of [A, M1, N2, OV]) {
      // Refused on the session flag, before the payload is read or the database is touched.
      const error = await rejection(revertDocumentStatus(untouchable, viewer(id), revert()));
      expect(error, `viewer ${id}`).toBeInstanceOf(ForbiddenError);
      expect(await rejection(revertDocumentStatus(untouchable, viewer(id), null))).toBeInstanceOf(ForbiddenError);
    }
  });

  it("an HR session whose live row is no longer an active HR admin is refused inside the transaction", async () => {
    for (const change of [{ isHrAdmin: false }, { isActive: false }]) {
      const initial = seed("ZATWIERDZONY");
      initial.people = initial.people.map((p) => (p.id === HR ? { ...p, ...change } : p));
      const fake = createFakeDb(initial);
      expect(await rejection(revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert()))).toBeInstanceOf(ForbiddenError);
      expect(fake.state.documents[0]?.status).toBe("ZATWIERDZONY");
      expect(fake.state.history).toEqual([]);
      expect(fake.state.audit).toEqual([]);
    }
  });

  it("a document whose status moved since HR looked is refused (STATUS_CHANGED), not reverted blind", async () => {
    const fake = createFakeDb(seed("DO_WALIDACJI"));
    await expectWorkflowError(revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert()), "STATUS_CHANGED", 409);
    expect(fake.state.documents[0]?.status).toBe("DO_WALIDACJI");
    expect(fake.state.history).toEqual([]);
    expect(fake.state.audit).toEqual([]);
  });

  it("nothing moves in a cycle that is not open", async () => {
    const initial = seed("ZATWIERDZONY");
    initial.cycle.status = "ZAMKNIETY";
    const fake = createFakeDb(initial);
    await expectWorkflowError(revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert()), "CYCLE_NOT_OPEN", 409);
    expect(fake.state.audit).toEqual([]);
  });

  it("a document that does not exist is not found", async () => {
    const fake = createFakeDb(seed("ZATWIERDZONY"));
    const error = await rejection(revertDocumentStatus(fake.as(viewer(HR)), viewer(HR), revert({ documentId: 999 })));
    expect(error).toBeInstanceOf(NotFoundError);
  });
});

describe("[WF-09] override validator for someone without a manager", () => {
  /** B at the top of the structure (no manager, nobody above), validated by OV set by HR. */
  function topOfStructure() {
    const initial = seed("SZKIC", "DO_WALIDACJI");
    initial.people = initial.people.map((p) => (p.id === B ? { ...p, managerId: null, ancestorIds: [] } : p));
    return createFakeDb(initial);
  }

  it("the override validator approves the document", async () => {
    const fake = topOfStructure();
    const view = await loadDocumentWorkflow(fake.as(viewer(OV)), viewer(OV), DOC_B, "OTWARTY");
    expect(view.actions).toEqual(["APPROVE", "RETURN"]);

    await transitionDocument(fake.as(viewer(OV)), viewer(OV), { documentId: DOC_B, action: "APPROVE" });
    expect(fake.state.documents[1]).toMatchObject({ status: "ZATWIERDZONY", validatorId: OV });
    expect(fake.state.audit).toEqual([expect.objectContaining({ actorId: OV, action: "STATUS_APPROVE" })]);
  });

  it("nobody else validates it: not the former manager, not HR, not the owner", async () => {
    const fake = topOfStructure();
    // M1 no longer manages B, so B's document is invisible to M1.
    expect(await rejection(transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_B, action: "APPROVE" }))).toBeInstanceOf(
      NotFoundError,
    );
    for (const id of [HR, B]) {
      const error = await rejection(transitionDocument(fake.as(viewer(id)), viewer(id), { documentId: DOC_B, action: "APPROVE" }));
      expect(error).toBeInstanceOf(ForbiddenError);
    }
    expect(fake.state.documents[1]?.status).toBe("DO_WALIDACJI");
  });
});
