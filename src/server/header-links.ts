// Header links "Lista kontaktów HR" and "GEDP Toolkit" (HOME-16). Whether to keep them and their
// addresses is still open (Q-08), so they come from the environment and stay hidden while empty.
// A value that is set but not an https URL is a misconfiguration and fails loudly: it would
// otherwise render a broken or unsafe link (javascript:, data:) in every page header.

type Env = Readonly<Record<string, string | undefined>>;

export interface HeaderLinks {
  hrContacts: string | null;
  toolkit: string | null;
}

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

export function readHeaderLinks(env: Env): HeaderLinks {
  return {
    hrContacts: readUrl(env, "GEDP_HR_CONTACTS_URL"),
    toolkit: readUrl(env, "GEDP_TOOLKIT_URL"),
  };
}
