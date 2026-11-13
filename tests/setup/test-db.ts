// Vitest globalSetup: bring the optional test database up to the latest migration once per run.
import { execSync } from "node:child_process";
import { testDatabaseUrl } from "./test-db-url";

export default function setup(): void {
  const url = testDatabaseUrl();
  if (!url) {
    console.info("TEST_DATABASE_URL not set - DB-backed tests are skipped.");
    return;
  }
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "inherit" });
}
