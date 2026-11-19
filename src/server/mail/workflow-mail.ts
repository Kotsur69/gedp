import "server-only";
import { createTranslator } from "next-intl";
import type { PrismaClient } from "@/generated/prisma/client";
import type { DocumentStatus } from "@/generated/prisma/enums";
import { LOCALES, type Locale } from "@/i18n/config";
import en from "../../../messages/en.json";
import pl from "../../../messages/pl.json";
import { getMailer, MailConfigError, readAppUrl, type MailMessage, type Mailer } from "./mailer";

// WF-07 e-mail notifications of the document workflow:
//   -> DO_WALIDACJI : every active validator - the N+1 and the HR-designated override (WF-09)
//   -> ZATWIERDZONY : the employee
//   -> ZWROCONY     : the employee, with the return comment
// Called only AFTER the status transaction committed. Nothing here can undo a status change: any
// failure (lookup, configuration, transport) is logged with the document id and swallowed.
// Data minimisation: the mail names the document, its year, its status and (for a return) the
// validator's comment - never goal contents. Both languages in one message, Polish first (NFR-01),
// since the recipient's UI language lives in their browser cookie, not in the database.

export type MailRecipientReader = Pick<PrismaClient, "employee">;

export interface WorkflowMailEvent {
  documentId: number;
  /** Owner of the document. */
  employeeId: number;
  to: DocumentStatus;
  cycleYear: number;
  /** The return comment (ZWROCONY); null otherwise. */
  comment: string | null;
}

export type WorkflowMailKind = "toValidate" | "approved" | "returned";
export type WorkflowMailOutcome = "sent" | "skipped" | "failed";

const KIND_BY_STATUS: Partial<Record<DocumentStatus, WorkflowMailKind>> = {
  DO_WALIDACJI: "toValidate",
  ZATWIERDZONY: "approved",
  ZWROCONY: "returned",
};

const CATALOGS: Readonly<Record<Locale, typeof pl>> = { pl, en: en as typeof pl };
const LANGUAGE_SEPARATOR = "\n\n----------------------------------------\n\n";

export interface WorkflowMailContent {
  kind: WorkflowMailKind;
  employeeName: string;
  cycleYear: number;
  status: DocumentStatus;
  comment: string | null;
  link: string;
}

/** Keeps the PL | EN subject well under the transport limit even for a very long imported name. */
const MAX_NAME_LENGTH = 80;
// Control characters (CR/LF included: header injection) and bidi overrides (a misleading subject).
const UNSAFE_NAME_CHARS = /[\p{Cc}‎‏‪-‮⁦-⁩]+/gu;

function displayName(name: string): string {
  return name.replace(UNSAFE_NAME_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH);
}

/** Subject and plain-text body in Polish, then English. */
export function composeWorkflowMail(content: WorkflowMailContent): Pick<MailMessage, "subject" | "text"> {
  const parts = LOCALES.map((locale) => {
    const t = createTranslator({ locale, messages: CATALOGS[locale] });
    const values = {
      employeeName: displayName(content.employeeName),
      // A string, so ICU does not group the digits ("2,027").
      year: String(content.cycleYear),
      comment: content.comment ?? "",
    };
    const status = t(`glossary.documentStatus.${content.status}`);
    const body = [
      t(`mail.workflow.${content.kind}.body`, values),
      t("mail.workflow.statusLine", { status }),
      t("mail.workflow.linkLine", { link: content.link }),
      t("mail.workflow.footer", { appName: t("common.appName") }),
    ].join("\n\n");
    return { subject: t(`mail.workflow.${content.kind}.subject`, values), body };
  });
  return {
    subject: parts.map((part) => part.subject).join(" | "),
    text: parts.map((part) => part.body).join(LANGUAGE_SEPARATOR),
  };
}

/** Where the link in the mail leads: the validator's review page, or the employee's goal centre. */
export function workflowMailLink(appUrl: string, kind: WorkflowMailKind, documentId: number): string {
  return kind === "toValidate" ? `${appUrl}/goal-centre/team/${documentId}` : `${appUrl}/goal-centre`;
}

const CONTACT = { select: { id: true, email: true, isActive: true } } as const;

interface Recipients {
  employeeName: string;
  /** Distinct addresses; empty when nobody active should get this mail. */
  to: string[];
}

/**
 * Live structure after the commit; inactive people get nothing. "To validate" goes to everyone the
 * permission module lets validate (permissions.ts: the N+1 AND the WF-09 override), never to the
 * owner themselves, even if misconfigured as their own manager or override.
 */
async function resolveRecipients(
  db: MailRecipientReader,
  event: WorkflowMailEvent,
  kind: WorkflowMailKind,
): Promise<Recipients | null> {
  const employee = await db.employee.findUnique({
    where: { id: event.employeeId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      isActive: true,
      manager: CONTACT,
      validatorOverride: CONTACT,
    },
  });
  if (!employee) return null;
  const employeeName = `${employee.firstName} ${employee.lastName}`;
  if (kind !== "toValidate") return { employeeName, to: employee.isActive ? [employee.email] : [] };
  const validators = [employee.validatorOverride, employee.manager].filter(
    (contact) => contact !== null && contact.isActive && contact.id !== event.employeeId,
  );
  return { employeeName, to: [...new Set(validators.map((contact) => contact!.email))] };
}

/** Upper bound for one send, so a hanging transport cannot hold the user's request open. */
export const MAIL_SEND_TIMEOUT_MS = 15_000;

export class MailTimeoutError extends Error {
  constructor(ms: number) {
    super(`mail send timed out after ${ms} ms`);
    this.name = "MailTimeoutError";
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new MailTimeoutError(ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Name and code only: a raw database or transport error may echo addresses or the comment. */
function describeError(error: unknown): string {
  if (error instanceof MailConfigError || error instanceof MailTimeoutError) return `${error.name}: ${error.message}`;
  const name = error instanceof Error ? error.name : typeof error;
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "-";
  return `${name} (${code})`;
}

export interface NotifyOptions {
  mailer?: () => Mailer;
  env?: Readonly<Record<string, string | undefined>>;
  timeoutMs?: number;
}

function logFailure(kind: WorkflowMailKind, documentId: number, error: unknown): void {
  console.error(`[mail] WF-07 ${kind} for document ${documentId} failed: ${describeError(error)}`);
}

/**
 * Sends the WF-07 mail for a committed transition. Never throws. "failed" when any recipient's
 * send failed; the others are still attempted.
 */
export async function notifyWorkflowTransition(
  db: MailRecipientReader,
  event: WorkflowMailEvent,
  options: NotifyOptions = {},
): Promise<WorkflowMailOutcome> {
  const kind = KIND_BY_STATUS[event.to];
  if (!kind) return "skipped";
  try {
    const recipients = await resolveRecipients(db, event, kind);
    if (!recipients || recipients.to.length === 0) {
      console.warn(`[mail] WF-07 ${kind} for document ${event.documentId}: no active recipient, not sent`);
      return "skipped";
    }
    const link = workflowMailLink(readAppUrl(options.env ?? process.env), kind, event.documentId);
    const content = composeWorkflowMail({
      kind,
      employeeName: recipients.employeeName,
      cycleYear: event.cycleYear,
      status: event.to,
      comment: kind === "returned" ? event.comment : null,
      link,
    });
    const mailer = (options.mailer ?? getMailer)();
    const timeoutMs = options.timeoutMs ?? MAIL_SEND_TIMEOUT_MS;
    const results = await Promise.allSettled(
      recipients.to.map((to) => withTimeout(mailer.send({ to, ...content }), timeoutMs)),
    );
    const failures = results.filter((result) => result.status === "rejected");
    failures.forEach((failure) => logFailure(kind, event.documentId, failure.reason));
    return failures.length === 0 ? "sent" : "failed";
  } catch (error: unknown) {
    logFailure(kind, event.documentId, error);
    return "failed";
  }
}
