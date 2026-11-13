import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer loads .env automatically; use Node's built-in loader (no dotenv dependency).
if (existsSync(".env")) {
  process.loadEnvFile(".env");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  // Optional on purpose: `prisma generate` (run by `npm run build`, e.g. on Vercel) needs no database.
  // Migrate / seed commands fail with Prisma's own "missing datasource url" error when it is unset.
  datasource: {
    url: process.env.DATABASE_URL,
  },
});
