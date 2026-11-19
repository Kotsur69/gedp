import { describe, expect, it } from "vitest";
import {
  createDevMailer,
  createMailerFromEnv,
  createStubMailer,
  DEV_OUTBOX_LIMIT,
  MailConfigError,
  readAppUrl,
  type MailMessage,
} from "./mailer";

const MESSAGE: MailMessage = { to: "p1@example.com", subject: "GEDP 2027: test", text: "Body" };
const quiet = () => undefined;

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

describe("[WF-07] dev transport - nothing leaves the machine", () => {
  it("keeps the message in the outbox and logs recipient and subject, never the body", async () => {
    const lines: string[] = [];
    const mailer = createDevMailer((line) => lines.push(line));
    await mailer.send({ ...MESSAGE, text: "Comment: secret return reason" });
    expect(mailer.outbox()).toEqual([{ ...MESSAGE, text: "Comment: secret return reason" }]);
    expect(lines).toEqual(['[mail:dev] to=p1@example.com subject="GEDP 2027: test"']);
    mailer.clear();
    expect(mailer.outbox()).toEqual([]);
  });

  it("the outbox is a copy and keeps only the most recent messages", async () => {
    const mailer = createDevMailer(quiet);
    for (let i = 0; i < DEV_OUTBOX_LIMIT + 5; i++) await mailer.send({ ...MESSAGE, subject: `n${i}` });
    const outbox = mailer.outbox();
    expect(outbox).toHaveLength(DEV_OUTBOX_LIMIT);
    expect(outbox[0]?.subject).toBe("n5");
    (outbox as MailMessage[]).pop();
    expect(mailer.outbox()).toHaveLength(DEV_OUTBOX_LIMIT);
  });

  it("refuses a subject with a line break, a bad address and extra fields", async () => {
    const mailer = createDevMailer(quiet);
    const bad: unknown[] = [
      { ...MESSAGE, subject: "Hi\r\nBcc: someone@example.com" },
      { ...MESSAGE, to: "not-an-address" },
      { ...MESSAGE, to: "a@example.com, b@example.com" },
      { ...MESSAGE, text: "" },
      { ...MESSAGE, cc: "x@example.com" },
    ];
    for (const message of bad) {
      expect(await rejection(mailer.send(message as MailMessage))).toBeInstanceOf(MailConfigError);
    }
    expect(mailer.outbox()).toEqual([]);
  });
});

describe("[WF-07] transport selection by environment (Q-01)", () => {
  it("defaults to dev only when NODE_ENV says development or test", () => {
    expect(createMailerFromEnv({ NODE_ENV: "test" }).transport).toBe("dev");
    expect(createMailerFromEnv({ NODE_ENV: "development", MAIL_TRANSPORT: " dev " }).transport).toBe("dev");
  });

  it("anywhere else an unset MAIL_TRANSPORT is a configuration error, not a silent dev outbox", () => {
    for (const NODE_ENV of ["production", "staging", undefined]) {
      expect(() => createMailerFromEnv({ NODE_ENV })).toThrow(MailConfigError);
    }
  });

  it("the dev outbox is refused in production even when asked for", () => {
    expect(() => createMailerFromEnv({ NODE_ENV: "production", MAIL_TRANSPORT: "dev" })).toThrow(/not allowed in production/);
  });

  it("an unknown transport fails loudly", () => {
    expect(() => createMailerFromEnv({ MAIL_TRANSPORT: "sendgrid" })).toThrow(/must be one of dev, smtp, graph/);
  });

  it("smtp and graph are stubs that refuse to send until Q-01 is decided", async () => {
    for (const transport of ["smtp", "graph"] as const) {
      const mailer = createMailerFromEnv({ NODE_ENV: "production", MAIL_TRANSPORT: transport });
      expect(mailer.transport).toBe(transport);
      const error = await rejection(mailer.send(MESSAGE));
      expect(error).toBeInstanceOf(MailConfigError);
      expect(String(error)).toContain("Q-01");
    }
    expect(await rejection(createStubMailer("smtp").send({ ...MESSAGE, to: "bad" }))).toBeInstanceOf(MailConfigError);
  });
});

describe("[WF-07] readAppUrl - base of the link in the mail", () => {
  it("uses GEDP_APP_URL without a trailing slash", () => {
    expect(readAppUrl({ GEDP_APP_URL: "https://gedp.example.com/" })).toBe("https://gedp.example.com");
    expect(readAppUrl({ GEDP_APP_URL: "https://gedp.example.com/app" })).toBe("https://gedp.example.com/app");
    expect(readAppUrl({ GEDP_APP_URL: "http://localhost:3000" })).toBe("http://localhost:3000");
  });

  it("falls back to the local dev server in development and test only", () => {
    expect(readAppUrl({ NODE_ENV: "development" })).toBe("http://localhost:3000");
    expect(readAppUrl({ NODE_ENV: "test" })).toBe("http://localhost:3000");
    expect(() => readAppUrl({ NODE_ENV: "production" })).toThrow(MailConfigError);
    expect(() => readAppUrl({})).toThrow(MailConfigError);
  });

  it("refuses plain http on a real host, other schemes, relative values, query strings and credentials", () => {
    const bad = [
      "http://gedp.example.com",
      "javascript:alert(1)",
      "/goal-centre",
      "https://gedp.example.com/?a=1",
      "https://gedp.example.com/#x",
      "https://user:secret@gedp.example.com",
    ];
    for (const value of bad) expect(() => readAppUrl({ GEDP_APP_URL: value })).toThrow(MailConfigError);
  });
});
