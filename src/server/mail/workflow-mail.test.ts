import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  A,
  B,
  createFakeDb,
  DOC_A,
  DOC_B,
  M1,
  OV,
  rejection,
  seed,
  viewer,
  type State,
} from "../../../tests/setup/workflow-fake-db";
import { transitionDocument } from "../workflow";
import { createDevMailer, MailConfigError, type DevMailer, type Mailer } from "./mailer";
import { composeWorkflowMail, notifyWorkflowTransition } from "./workflow-mail";

// WF-07 against the in-memory workflow fake and the dev transport: who gets which mail, that the
// mail goes out only after the commit and can never undo it, and that it carries no goal content.

const APP = { GEDP_APP_URL: "https://gedp.example.com" };
const GOAL_TITLE = "Cut scrap rate on line 4 by 12%";
const BHP_COMMITMENT = "Report every near miss";
const RETURN_COMMENT = "Weights must add up to 100%";

let dev: DevMailer;
let errorLog: MockInstance;
let warnLog: MockInstance;

beforeEach(() => {
  dev = createDevMailer(() => undefined);
  errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  warnLog = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

type Status = State["documents"][number]["status"];

/** Seed whose goals carry recognisable content, to prove it never reaches a mail. */
function seedWithContent(statusA: Status = "SZKIC", statusB: Status = statusA): State {
  const state = seed(statusA, statusB);
  return {
    ...state,
    performanceGoals: state.performanceGoals.map((goal) => ({ ...goal, title: GOAL_TITLE })),
  };
}

const options = (mailer: Mailer = dev) => ({ mailer: () => mailer, env: APP });

describe("[WF-07] each transition mails the right person", () => {
  it("SEND -> the N+1 gets a link to the review page", async () => {
    const fake = createFakeDb(seedWithContent());
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, options());

    const [mail, ...rest] = dev.outbox();
    expect(rest).toEqual([]);
    expect(mail?.to).toBe(`p${M1}@example.com`);
    expect(mail?.subject).toContain("Test P2");
    expect(mail?.subject).toContain("GEDP 2027");
    expect(mail?.text).toContain(`https://gedp.example.com/goal-centre/team/${DOC_A}`);
  });

  it("SEND -> both the HR-designated validator and the N+1, since both may validate (WF-09)", async () => {
    const fake = createFakeDb(seedWithContent());
    await transitionDocument(fake.as(viewer(B)), viewer(B), { documentId: DOC_B, action: "SEND" }, options());
    expect(dev.outbox().map((m) => m.to)).toEqual([`p${OV}@example.com`, `p${M1}@example.com`]);
  });

  it("SEND -> only active validators", async () => {
    const state = seedWithContent();
    const fake = createFakeDb({ ...state, people: state.people.map((p) => (p.id === OV ? { ...p, isActive: false } : p)) });
    await transitionDocument(fake.as(viewer(B)), viewer(B), { documentId: DOC_B, action: "SEND" }, options());
    expect(dev.outbox().map((m) => m.to)).toEqual([`p${M1}@example.com`]);
  });

  it("SEND -> never to the owner, even when misconfigured as their own override", async () => {
    const state = seedWithContent();
    const people = state.people.map((p) => (p.id === A ? { ...p, validatorOverrideId: A } : p));
    const fake = createFakeDb({ ...state, people });
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, options());
    expect(dev.outbox().map((m) => m.to)).toEqual([`p${M1}@example.com`]);
  });

  it("SEND with no active validator: nothing sent, the skip is logged with the document id", async () => {
    const state = seedWithContent();
    const fake = createFakeDb({ ...state, people: state.people.map((p) => (p.id === M1 ? { ...p, isActive: false } : p)) });
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, options());
    expect(dev.outbox()).toEqual([]);
    expect(fake.state.documents[0]?.status).toBe("DO_WALIDACJI");
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining(`document ${DOC_A}`));
  });

  it("APPROVE -> the employee, with a link to their goal centre", async () => {
    const fake = createFakeDb(seedWithContent("DO_WALIDACJI"));
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }, options());

    const [mail] = dev.outbox();
    expect(mail?.to).toBe(`p${A}@example.com`);
    expect(mail?.subject).toContain("zatwierdzony");
    expect(mail?.subject).toContain("approved");
    expect(mail?.text).toContain("https://gedp.example.com/goal-centre");
    expect(mail?.text).not.toContain("/goal-centre/team/");
  });

  it("RETURN -> the employee, with the return comment", async () => {
    const fake = createFakeDb(seedWithContent("DO_WALIDACJI"));
    await transitionDocument(
      fake.as(viewer(M1)),
      viewer(M1),
      { documentId: DOC_A, action: "RETURN", comment: `  ${RETURN_COMMENT}  ` },
      options(),
    );
    const [mail] = dev.outbox();
    expect(mail?.to).toBe(`p${A}@example.com`);
    expect(mail?.text).toContain(`Komentarz walidatora:\n${RETURN_COMMENT}`);
    expect(mail?.text).toContain(`Comment from your validator:\n${RETURN_COMMENT}`);
  });

  it("a refused transition sends nothing", async () => {
    const fake = createFakeDb(seedWithContent());
    await rejection(transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }, options()));
    expect(dev.outbox()).toEqual([]);
  });

  it("an inactive employee gets nothing, and the skip is logged with the document id", async () => {
    const state = seedWithContent("DO_WALIDACJI");
    const fake = createFakeDb({ ...state, people: state.people.map((p) => (p.id === A ? { ...p, isActive: false } : p)) });
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }, options());
    expect(dev.outbox()).toEqual([]);
    expect(fake.state.documents[0]?.status).toBe("ZATWIERDZONY");
    expect(warnLog).toHaveBeenCalledWith(expect.stringContaining(`document ${DOC_A}`));
  });
});

describe("[WF-07] a mail failure never rolls back the status", () => {
  const failing: Mailer = {
    transport: "smtp",
    send: async () => {
      throw Object.assign(new Error(`SMTP rejected p${A}@example.com: ${RETURN_COMMENT}`), { code: "EENVELOPE" });
    },
  };

  it("transport error: status, history and audit stay committed; the failure is logged with the document id", async () => {
    const fake = createFakeDb(seedWithContent("DO_WALIDACJI"));
    const result = await transitionDocument(
      fake.as(viewer(M1)),
      viewer(M1),
      { documentId: DOC_A, action: "RETURN", comment: RETURN_COMMENT },
      options(failing),
    );

    expect(result).toMatchObject({ documentId: DOC_A, to: "ZWROCONY" });
    expect(fake.state.documents[0]?.status).toBe("ZWROCONY");
    expect(fake.state.history).toHaveLength(1);
    expect(fake.state.audit).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledTimes(1);
    const line = String(errorLog.mock.calls[0]?.[0]);
    expect(line).toContain(`document ${DOC_A}`);
    expect(line).toContain("EENVELOPE");
    // The raw transport message may echo the address or the comment: it is not logged.
    expect(line).not.toContain("@example.com");
    expect(line).not.toContain(RETURN_COMMENT);
  });

  it("configuration error (e.g. production without MAIL_TRANSPORT): status stays committed", async () => {
    const fake = createFakeDb(seedWithContent());
    const broken = () => {
      throw new MailConfigError("MAIL_TRANSPORT is not set");
    };
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, { mailer: broken, env: APP });
    expect(fake.state.documents[0]?.status).toBe("DO_WALIDACJI");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MAIL_TRANSPORT is not set"));
  });

  it("recipient lookup error: logged, never thrown", async () => {
    const db = {
      employee: {
        findUnique: async () => {
          throw Object.assign(new Error("connection reset"), { code: "P1017" });
        },
      },
    } as unknown as Parameters<typeof notifyWorkflowTransition>[0];
    const event = { documentId: DOC_A, employeeId: A, to: "ZATWIERDZONY" as const, cycleYear: 2027, comment: null };
    expect(await notifyWorkflowTransition(db, event, options())).toBe("failed");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(`document ${DOC_A} failed: Error (P1017)`));
  });

  it("a hanging transport times out instead of holding the request open", async () => {
    const hanging: Mailer = { transport: "smtp", send: () => new Promise<void>(() => undefined) };
    const fake = createFakeDb(seedWithContent("DO_WALIDACJI"));
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }, {
      ...options(hanging),
      timeoutMs: 5,
    });
    expect(fake.state.documents[0]?.status).toBe("ZATWIERDZONY");
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("MailTimeoutError"));
  });

  it("one validator's failed send does not stop the other's", async () => {
    const sent: string[] = [];
    const flaky: Mailer = {
      transport: "smtp",
      send: async ({ to }) => {
        if (to === `p${OV}@example.com`) throw new Error("mailbox full");
        sent.push(to);
      },
    };
    const event = { documentId: DOC_B, employeeId: B, to: "DO_WALIDACJI" as const, cycleYear: 2027, comment: null };
    const fake = createFakeDb(seedWithContent());
    expect(await notifyWorkflowTransition(fake.as(viewer(B)), event, options(flaky))).toBe("failed");
    expect(sent).toEqual([`p${M1}@example.com`]);
    expect(errorLog).toHaveBeenCalledTimes(1);
  });

  it("the mail goes out after the commit, not inside the transaction", async () => {
    const fake = createFakeDb(seedWithContent());
    let statusWhenSent: string | undefined;
    const observing: Mailer = {
      transport: "dev",
      send: async () => {
        statusWhenSent = fake.state.documents[0]?.status;
      },
    };
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, options(observing));
    expect(statusWhenSent).toBe("DO_WALIDACJI");
  });
});

describe("[WF-07] data minimisation and templates", () => {
  it("no goal content in any mail, in either language", async () => {
    const fake = createFakeDb(seedWithContent());
    const send = { documentId: DOC_A, action: "SEND" };
    await transitionDocument(fake.as(viewer(A)), viewer(A), send, options());
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "RETURN", comment: "Fix it" }, options());
    await transitionDocument(fake.as(viewer(A)), viewer(A), send, options());
    await transitionDocument(fake.as(viewer(M1)), viewer(M1), { documentId: DOC_A, action: "APPROVE" }, options());

    expect(dev.outbox()).toHaveLength(4);
    for (const mail of dev.outbox()) {
      const all = `${mail.subject}\n${mail.text}`;
      expect(all).not.toContain(GOAL_TITLE);
      expect(all).not.toContain(BHP_COMMITMENT);
      expect(all).not.toMatch(/weight|waga|60|40/i);
    }
  });

  it("Polish first, then English, with the glossary status names and an ungrouped year", () => {
    const { subject, text } = composeWorkflowMail({
      kind: "approved",
      employeeName: "Anna Nowak",
      cycleYear: 2027,
      status: "ZATWIERDZONY",
      comment: null,
      link: "https://gedp.example.com/goal-centre",
    });
    expect(subject).toBe("GEDP 2027: Twój dokument został zatwierdzony | GEDP 2027: your document has been approved");
    expect(text.indexOf("Status dokumentu: Zatwierdzony")).toBeGreaterThan(-1);
    expect(text.indexOf("Document status: Approved")).toBeGreaterThan(text.indexOf("Status dokumentu: Zatwierdzony"));
    expect(text).not.toContain("2,027");
  });

  it("a name with a line break or bidi override cannot inject a header or disguise the subject", () => {
    const { subject } = composeWorkflowMail({
      kind: "toValidate",
      employeeName: "Eve\r\nBcc: x@example.com‮gnp.exe",
      cycleYear: 2027,
      status: "DO_WALIDACJI",
      comment: null,
      link: "https://gedp.example.com/goal-centre/team/10",
    });
    expect(subject).not.toMatch(/[\r\n‮]/);
    expect(subject).toContain("Eve Bcc: x@example.com gnp.exe");
  });

  it("a very long imported name still fits the subject limit", async () => {
    const state = seedWithContent();
    const people = state.people.map((p) => (p.id === A ? { ...p, lastName: "X".repeat(500) } : p));
    const fake = createFakeDb({ ...state, people });
    await transitionDocument(fake.as(viewer(A)), viewer(A), { documentId: DOC_A, action: "SEND" }, options());
    expect(dev.outbox()).toHaveLength(1);
  });

  it("a status without a WF-07 mail (back to draft) sends nothing", async () => {
    const event = { documentId: DOC_A, employeeId: A, to: "SZKIC" as const, cycleYear: 2027, comment: null };
    const untouched = {} as Parameters<typeof notifyWorkflowTransition>[0];
    expect(await notifyWorkflowTransition(untouched, event, options())).toBe("skipped");
    expect(dev.outbox()).toEqual([]);
  });
});
