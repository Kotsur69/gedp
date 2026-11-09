import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // honour the "@/*" alias from tsconfig.json
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tests/unit/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "tests/e2e/**"],
    // the suite is empty until features land; do not fail on zero tests
    passWithNoTests: true,
  },
});
