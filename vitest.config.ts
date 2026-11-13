import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // honour the "@/*" alias from tsconfig.json
    tsconfigPaths: true,
    alias: {
      // `server-only` throws outside the react-server condition; in unit tests the guard is a no-op.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    // Migrates TEST_DATABASE_URL when set; DB-backed tests are skipped without it.
    globalSetup: ["tests/setup/test-db.ts"],
    // DB-backed test files share one database, so files run one after another.
    fileParallelism: false,
    passWithNoTests: true,
  },
});
