import type { PrismaClient } from "@/generated/prisma/client";
import { safeHttpUrl, type LinkContentKey } from "@/domain/content-block";
import type { Locale } from "@/i18n/config";

// Header links "Lista kontaktów HR" and "GEDP Toolkit" (HOME-16, HR-06). HR sets their addresses
// per language in the HR panel (content_block LINK_KONTAKTY_HR / LINK_GEDP_TOOLKIT); a blank
// address hides the link. Until HR has published a link, the deployment's environment value is
// used (GEDP_HR_CONTACTS_URL / GEDP_TOOLKIT_URL). An env value that is set but not an https URL
// is a misconfiguration and fails loudly: it would otherwise render a broken or unsafe link in
// every page header.

type Env = Readonly<Record<string, string | undefined>>;

export interface HeaderLinks {
  hrContacts: string | null;
  toolkit: string | null;
}

export type HeaderLinksDb = Pick<PrismaClient, "contentBlock">;

function readUrl(env: Env, name: string): string | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute https URL, got "${raw}"`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must use https, got "${url.protocol}"`);
  return url.href;
}

const ENV_NAMES: Readonly<Record<keyof HeaderLinks, string>> = {
  hrContacts: "GEDP_HR_CONTACTS_URL",
  toolkit: "GEDP_TOOLKIT_URL",
};

export function readHeaderLinks(env: Env): HeaderLinks {
  return {
    hrContacts: readUrl(env, ENV_NAMES.hrContacts),
    toolkit: readUrl(env, ENV_NAMES.toolkit),
  };
}

const LINK_KEYS: Readonly<Record<keyof HeaderLinks, LinkContentKey>> = {
  hrContacts: "LINK_KONTAKTY_HR",
  toolkit: "LINK_GEDP_TOOLKIT",
};

async function publishedLink(
  db: HeaderLinksDb,
  key: LinkContentKey,
  locale: Locale,
  now: Date,
): Promise<{ href: string | null } | null> {
  const block = await db.contentBlock.findFirst({
    where: { key, publishedAt: { not: null, lte: now } },
    orderBy: { version: "desc" },
    select: { version: true, contentPl: true, contentEn: true },
  });
  if (!block) return null;
  const raw = (locale === "en" ? block.contentEn : block.contentPl).trim();
  if (raw === "") return { href: null };
  const href = safeHttpUrl(raw);
  // Publishing validates the address, so this is a row written past the HR panel. Hide the link
  // rather than render it or break every page header.
  if (href === null) console.error(`[header-links] ${key} version ${block.version} is not an http(s) URL; link hidden`);
  return { href };
}

/** Header links for the given language: HR's newest published address, else the env value. */
export async function loadHeaderLinks(
  db: HeaderLinksDb,
  locale: Locale,
  env: Env,
  now: Date = new Date(),
): Promise<HeaderLinks> {
  const [hrContacts, toolkit] = await Promise.all([
    publishedLink(db, LINK_KEYS.hrContacts, locale, now),
    publishedLink(db, LINK_KEYS.toolkit, locale, now),
  ]);
  // Each env value is read only for its own link while HR never published it, so a bad env value
  // cannot break the header once HR manages that link.
  return {
    hrContacts: hrContacts ? hrContacts.href : readUrl(env, ENV_NAMES.hrContacts),
    toolkit: toolkit ? toolkit.href : readUrl(env, ENV_NAMES.toolkit),
  };
}
