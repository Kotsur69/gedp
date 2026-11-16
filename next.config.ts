import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import packageJson from "./package.json" with { type: "json" };

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
