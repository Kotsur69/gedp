import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import packageJson from "./package.json" with { type: "json" };
import { assertNoPublicSecrets } from "./src/env";
import { CSP_HEADER, PATH_CSPS, STATIC_SECURITY_HEADERS } from "./src/server/security-headers";

// SEC-06: NEXT_PUBLIC_ values are inlined into the browser bundle at build time, so a
// secret-looking name fails here, before anything ships (runtime values are checked at start).
assertNoPublicSecrets(process.env);

// Glossary + PL/EN (NFR-01/02); locale resolution lives in src/i18n/request.ts.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/**
 * Release date shown in the footer (NFR-04): APP_RELEASE_DATE (YYYY-MM-DD) when the release
 * pipeline sets it, otherwise the build date. Fails the build on a malformed value.
 */
function releaseDate(raw: string | undefined): string {
  const value = raw?.trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`APP_RELEASE_DATE must be YYYY-MM-DD, got "${raw}"`);
  }
  return value;
}

const nextConfig: NextConfig = {
  // Inlined at build time: the footer shows what was actually built.
  env: {
    APP_VERSION: packageJson.version,
    APP_RELEASE_DATE: releaseDate(process.env.APP_RELEASE_DATE),
  },
  // SEC-06: never ship source maps to the browser (also the default; explicit so it stays off).
  productionBrowserSourceMaps: false,
  // Static security headers on every response, including assets the proxy skips.
  // The nonce-based CSP is per request, so proxy.ts sets it.
  async headers() {
    return [
      { source: "/:path*", headers: [...STATIC_SECURITY_HEADERS] },
      ...PATH_CSPS.map(({ source, csp }) => ({ source, headers: [{ key: CSP_HEADER, value: csp }] })),
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
