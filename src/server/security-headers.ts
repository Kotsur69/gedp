// Security headers (SEC-05/06 baseline; the ArcelorMittal checklist, Q-01, may add to it).
// No `server-only` and no imports: next.config.ts and proxy.ts both load this module.

/** Headers that never change per request: next.config.ts attaches them to every response. */
export const STATIC_SECURITY_HEADERS: ReadonlyArray<{ key: string; value: string }> = [
  // Two years, this host only: includeSubDomains on a corporate parent domain would force HTTPS
  // on unrelated sibling hosts; add it only with the domain owner's sign-off (Q-01).
  // Ignored by browsers over plain http, so safe on localhost.
  { key: "Strict-Transport-Security", value: "max-age=63072000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Legacy twin of CSP frame-ancestors 'none' for browsers that ignore CSP.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

export const CSP_HEADER = "Content-Security-Policy";

/**
 * Fixed CSPs for paths proxy.ts does not match, so they never get the nonce CSP:
 * brand files (an SVG opened directly is a document and could run script) and the Auth.js
 * built-in pages (plain HTML forms with an inline <style>, no scripts).
 */
export const PATH_CSPS: ReadonlyArray<{ source: string; csp: string }> = [
  { source: "/brand/:path*", csp: "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'" },
  {
    source: "/api/auth/:path*",
    csp: "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  },
];

/** 128 bits of randomness, base64: unpredictable and unique per request. */
export function generateNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/**
 * Nonce-based CSP: no 'unsafe-inline' / 'unsafe-eval' in script-src in production.
 * 'strict-dynamic' lets the nonced Next.js runtime load its own chunks.
 * Development needs 'unsafe-eval' (React debug stacks) and 'unsafe-inline' styles (HMR).
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // style="" attributes (next/image sets one) cannot carry a nonce. They cannot run script, so
    // only attributes are relaxed; <style> elements stay nonce-only through style-src.
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (!isDev) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}
