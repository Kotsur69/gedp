import { z } from "zod";

// HR-edited content blocks (HR-06, HOME-02/11/16): the start announcement, the home intro text and
// the two header link addresses, each in Polish and English. Shared by the HR editor (quick
// feedback) and the server (the check that counts). Every publish is a new content_block version.
//
// The markdown is still rendered through the sanitising renderer (components/home/intro-markdown),
// which is the real defence. These rules reject what the renderer would silently drop, so HR sees
// the problem before publishing: raw HTML, and links that are not http(s) or mailto.

export const MARKDOWN_CONTENT_KEYS = ["KOMUNIKAT_STARTOWY", "TEKST_POWITALNY"] as const;
export const LINK_CONTENT_KEYS = ["LINK_KONTAKTY_HR", "LINK_GEDP_TOOLKIT"] as const;
export const CONTENT_KEYS = [...MARKDOWN_CONTENT_KEYS, ...LINK_CONTENT_KEYS] as const;

export type MarkdownContentKey = (typeof MARKDOWN_CONTENT_KEYS)[number];
export type LinkContentKey = (typeof LINK_CONTENT_KEYS)[number];
export type ContentKey = (typeof CONTENT_KEYS)[number];

export const MAX_MARKDOWN_LENGTH = 10_000;
export const MAX_URL_LENGTH = 2_000;

export const CONTENT_ERROR_CODES = [
  "INVALID_INPUT",
  "TEXT_TOO_LONG",
  "INVALID_TEXT",
  "HTML_NOT_ALLOWED",
  "UNSAFE_LINK",
  "INVALID_URL",
  "STALE",
] as const;
export type ContentErrorCode = (typeof CONTENT_ERROR_CODES)[number];
export type ContentFieldErrors = Partial<Record<"contentPl" | "contentEn", ContentErrorCode>>;

/** The newest version of a block, sent back with STALE so the editor can show it. */
export interface LatestContent {
  version: number;
  contentPl: string;
  contentEn: string;
}

const isErrorCode = (value: unknown): value is ContentErrorCode =>
  typeof value === "string" && (CONTENT_ERROR_CODES as readonly string[]).includes(value);

export const isMarkdownKey = (key: ContentKey): key is MarkdownContentKey =>
  (MARKDOWN_CONTENT_KEYS as readonly string[]).includes(key);

// Control and invisible bidi characters; markdown may keep tabs and line breaks.
const HIDDEN_IN_MARKDOWN = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁩﻿]/u;
const HIDDEN_IN_URL = /[\u0000- \u007F-\u009F​-‏‪-‮⁠-⁩﻿]/u;

// Same allow-list as the renderer's urlTransform: anything else (javascript:, data:, relative
// paths, entity-obfuscated schemes) would lose its link, so it is refused up front. An http(s)
// target must also be a whole URL (the toolbar's bare "https://" is not).
const MAILTO_LINK = /^mailto:\S+$/i;

// An HTML tag or comment, also an unclosed one such as "<div" at the end of a line (CommonMark
// opens an HTML block there and the renderer drops what follows). "<https://...>" and
// "<name@host>" autolinks do not match: the tag name must be followed by whitespace, "/", ">"
// or the end of the line.
const HTML_TAG = /<\/?[a-z][a-z0-9-]*(?=[\s/>]|$)|<!--/im;

// Where markdown keeps link targets: [text](target), [label]: target, <scheme:target>.
const INLINE_LINK_TARGET = /\]\(\s*(<[^>\n]*>|[^\s)]*)/g;
// Definitions may sit in a quote or list item, and the target may start on the next line.
const REFERENCE_LINK_TARGET = /^[ \t>*+\-\d.)]*\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/gm;
const AUTOLINK_TARGET = /<([a-z][a-z0-9+.-]{1,31}:[^<>\s]*)>/gi;

const unwrap = (target: string): string => target.replace(/^<|>$/g, "").trim();

/** Every link target written in the markdown (inline, reference definition, autolink). */
export function markdownLinkTargets(markdown: string): string[] {
  // A "[label]: <target>" definition also looks like an autolink, hence the de-duplication.
  return [
    ...new Set([
      ...[...markdown.matchAll(INLINE_LINK_TARGET)].map((match) => unwrap(match[1])),
      ...[...markdown.matchAll(REFERENCE_LINK_TARGET)].map((match) => unwrap(match[1])),
      ...[...markdown.matchAll(AUTOLINK_TARGET)].map((match) => match[1]),
    ]),
  ];
}

/** The first problem with HR markdown, or null when it can be published. */
export function markdownProblem(markdown: string): ContentErrorCode | null {
  if (markdown.length > MAX_MARKDOWN_LENGTH) return "TEXT_TOO_LONG";
  if (HIDDEN_IN_MARKDOWN.test(markdown)) return "INVALID_TEXT";
  if (HTML_TAG.test(markdown)) return "HTML_NOT_ALLOWED";
  const isSafeLink = (target: string) => MAILTO_LINK.test(target) || safeHttpUrl(target) !== null;
  if (markdownLinkTargets(markdown).some((target) => !isSafeLink(target))) return "UNSAFE_LINK";
  return null;
}

/**
 * The normalised absolute http(s) URL, or null when the value is not one (javascript:, data:,
 * relative, malformed, with credentials). A header link opens straight from every page header.
 */
export function safeHttpUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH || HIDDEN_IN_URL.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.hostname === "") return null;
  return url.href;
}

/** The first problem with a header link address ("" hides the link), or null. */
export function linkProblem(value: string): ContentErrorCode | null {
  if (value === "") return null;
  if (value.length > MAX_URL_LENGTH) return "TEXT_TOO_LONG";
  return safeHttpUrl(value) === null ? "INVALID_URL" : null;
}

const normaliseMarkdown = (value: string): string => value.replace(/\r\n?/g, "\n").trim();

const contentText = z.string("INVALID_INPUT");

export const publishContentSchema = z
  .strictObject({
    key: z.enum(CONTENT_KEYS, "INVALID_INPUT"),
    /** The version the editor was opened on; null when nothing was published yet. */
    baseVersion: z.number("INVALID_INPUT").int("INVALID_INPUT").positive("INVALID_INPUT").nullable(),
    contentPl: contentText,
    contentEn: contentText,
  })
  .transform((input) => {
    const normalise = isMarkdownKey(input.key) ? normaliseMarkdown : (value: string) => value.trim();
    return { ...input, contentPl: normalise(input.contentPl), contentEn: normalise(input.contentEn) };
  })
  .superRefine((input, context) => {
    const check = isMarkdownKey(input.key) ? markdownProblem : linkProblem;
    for (const field of ["contentPl", "contentEn"] as const) {
      const problem = check(input[field]);
      if (problem) context.addIssue({ code: "custom", path: [field], message: problem });
    }
  })
  .transform((input) => {
    if (isMarkdownKey(input.key)) return input;
    // Store the normalised form, so the header renders exactly what was checked.
    const normaliseUrl = (value: string) => (value === "" ? "" : (safeHttpUrl(value) ?? value));
    return { ...input, contentPl: normaliseUrl(input.contentPl), contentEn: normaliseUrl(input.contentEn) };
  });

export type PublishContentInput = z.output<typeof publishContentSchema>;

/** First error code per text field; anything else (key, version, shape) is INVALID_INPUT. */
export function contentFieldErrors(error: z.ZodError): ContentFieldErrors {
  const errors: ContentFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if ((field !== "contentPl" && field !== "contentEn") || errors[field] !== undefined) continue;
    errors[field] = isErrorCode(issue.message) ? issue.message : "INVALID_INPUT";
  }
  return errors;
}
