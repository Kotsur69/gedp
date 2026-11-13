// Shared guard for DB-backed tests. They TRUNCATE tables, so they may only ever touch a
// local, clearly-named test database - never the dev (Supabase) or production database.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Returns the validated TEST_DATABASE_URL, or null when DB tests should be skipped. */
export function testDatabaseUrl(): string | null {
  const raw = process.env.TEST_DATABASE_URL;
  if (!raw) return null;
  const url = new URL(raw);
  const dbName = url.pathname.replace(/^\//, "");
  // Query parameters such as ?host= can redirect pg to another server, so none are allowed.
  if (url.search) {
    throw new Error("TEST_DATABASE_URL must not contain query parameters");
  }
  if (!LOCAL_HOSTS.has(url.hostname)) {
    throw new Error(`TEST_DATABASE_URL must point to a local host, got "${url.hostname}"`);
  }
  if (!dbName.toLowerCase().includes("test")) {
    throw new Error(`TEST_DATABASE_URL database name must contain "test", got "${dbName}"`);
  }
  return raw;
}
