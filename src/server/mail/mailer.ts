import "server-only";
import { z } from "zod";

// Outgoing e-mail (WF-07). Every sender goes through the Mailer interface; the transport is picked
// from the environment:
//   MAIL_TRANSPORT=dev    - nothing leaves the machine: the message is kept in an in-memory outbox
//                           and one line is logged (default when NODE_ENV is development or
//                           test; refused in production)
//   MAIL_TRANSPORT=smtp   - production transport, not built yet: depends on Q-01 (SMTP vs Graph)
//   MAIL_TRANSPORT=graph  - same
// Anywhere else an unset MAIL_TRANSPORT is a misconfiguration and every send fails loudly
// (callers log it), so mail is never silently dropped and never silently routed to the dev outbox.

export const MAIL_TRANSPORTS = ["dev", "smtp", "graph"] as const;
export type MailTransportName = (typeof MAIL_TRANSPORTS)[number];

const MAX_SUBJECT_LENGTH = 300;
const MAX_TEXT_LENGTH = 20_000;
/** The dev outbox keeps the most recent messages only, so a long dev session cannot grow it forever. */
export const DEV_OUTBOX_LIMIT = 200;

/** Plain-text message. Subject has no line breaks (header injection), recipient is one address. */
export const mailMessageSchema = z
  .object({
    to: z.email(),
    subject: z
      .string()
      .min(1)
      .max(MAX_SUBJECT_LENGTH)
      .refine((subject) => !/[\r\n]/.test(subject), "subject must be a single line"),
    text: z.string().min(1).max(MAX_TEXT_LENGTH),
  })
  .strict();

export type MailMessage = z.infer<typeof mailMessageSchema>;

export interface Mailer {
  readonly transport: MailTransportName;
  /** Resolves once the transport accepted the message; rejects with the reason otherwise. */
  send(message: MailMessage): Promise<void>;
}

export interface DevMailer extends Mailer {
  readonly transport: "dev";
  /** Messages "sent" so far, oldest first (a copy). */
  outbox(): readonly MailMessage[];
  clear(): void;
}

export class MailConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MailConfigError";
  }
}

/** Throws on a malformed message, so every transport refuses the same things. */
export function parseMailMessage(message: unknown): MailMessage {
  const parsed = mailMessageSchema.safeParse(message);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.join(".") || "message";
    throw new MailConfigError(`invalid mail message: ${field}`);
  }
  return parsed.data;
}

export function createDevMailer(log: (line: string) => void = console.info): DevMailer {
  let sent: MailMessage[] = [];
  return {
    transport: "dev",
    async send(message) {
      const valid = parseMailMessage(message);
      sent = [...sent, valid].slice(-DEV_OUTBOX_LIMIT);
      // Recipient and subject only: the body may carry a return comment.
      log(`[mail:dev] to=${valid.to} subject="${valid.subject}"`);
    },
    outbox: () => [...sent],
    clear() {
      sent = [];
    },
  };
}

/** SMTP / Microsoft Graph placeholder until Q-01 is decided: every send fails, and callers log it. */
export function createStubMailer(transport: Exclude<MailTransportName, "dev">): Mailer {
  return {
    transport,
    async send(message) {
      parseMailMessage(message);
      throw new MailConfigError(`MAIL_TRANSPORT=${transport} is not implemented yet (Q-01)`);
    },
  };
}

type Env = Readonly<Record<string, string | undefined>>;

/** Defaults that keep mail on the machine apply only where NODE_ENV says so explicitly (opt-in). */
const LOCAL_NODE_ENVS: ReadonlySet<string> = new Set(["development", "test"]);
const isLocalEnv = (env: Env): boolean => LOCAL_NODE_ENVS.has(env.NODE_ENV ?? "");

export function createMailerFromEnv(env: Env): Mailer {
  const raw = env.MAIL_TRANSPORT?.trim();
  if (!raw) {
    if (!isLocalEnv(env)) throw new MailConfigError("MAIL_TRANSPORT is not set");
    return createDevMailer();
  }
  if (!(MAIL_TRANSPORTS as readonly string[]).includes(raw)) {
    throw new MailConfigError(`MAIL_TRANSPORT must be one of ${MAIL_TRANSPORTS.join(", ")}`);
  }
  const transport = raw as MailTransportName;
  if (transport !== "dev") return createStubMailer(transport);
  // In production the dev outbox would swallow every mail and log real addresses.
  if (env.NODE_ENV === "production") throw new MailConfigError("MAIL_TRANSPORT=dev is not allowed in production");
  return createDevMailer();
}

// One mailer per server process (survives dev hot reloads, so the dev outbox does too).
const globalForMail = globalThis as unknown as { gedpMailer?: Mailer };

/** The process-wide mailer. Throws MailConfigError on a bad configuration. */
export function getMailer(): Mailer {
  if (globalForMail.gedpMailer) return globalForMail.gedpMailer;
  const mailer = createMailerFromEnv(process.env);
  globalForMail.gedpMailer = mailer;
  return mailer;
}

const DEV_APP_URL = "http://localhost:3000";
const LOCAL_HOSTS: ReadonlySet<string> = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Base URL for links in e-mails (GEDP_APP_URL), without a trailing slash. https only, except http
 * on localhost; no credentials, query or fragment. Unset falls back to the local dev server only in
 * development and test.
 */
export function readAppUrl(env: Env): string {
  const raw = env.GEDP_APP_URL?.trim();
  if (!raw) {
    if (!isLocalEnv(env)) throw new MailConfigError("GEDP_APP_URL is not set");
    return DEV_APP_URL;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MailConfigError("GEDP_APP_URL must be an absolute URL");
  }
  // Every mail would carry them.
  if (url.username || url.password) throw new MailConfigError("GEDP_APP_URL must not contain credentials");
  const isLocalHttp = url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new MailConfigError(`GEDP_APP_URL must use https, got "${url.protocol}"`);
  }
  if (url.search || url.hash) throw new MailConfigError("GEDP_APP_URL must not have a query or fragment");
  return url.href.replace(/\/+$/, "");
}
