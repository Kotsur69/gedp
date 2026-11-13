// Creates / rotates the password test accounts (src/server/test-logins.ts) and writes their
// credentials to a file OUTSIDE the repository. Passwords are never printed to the console.
//
//   npm run test-logins -- <output-file>
//   remote DB (e.g. the Supabase dev project used by Vercel): TEST_LOGINS_ALLOW_REMOTE=1
//
// Runs with the react-server condition (see package.json) so `server-only` imports resolve.
import { chmodSync, closeSync, existsSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "@/generated/prisma/client";
import { upsertTestLogins, type IssuedLogin } from "@/server/test-logins";

const LOCAL_DB_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
const OWNER_ONLY = 0o600;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// Same convention as prisma.config.ts: .env is read only when the variable is not already set.
function loadEnv(): void {
  const envFile = path.join(REPO_ROOT, ".env");
  if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
}

function outputPath(): string {
  const arg = process.argv[2];
  if (!arg) fail("Usage: npm run test-logins -- <output-file outside the repository>");
  const resolved = path.resolve(arg);
  const relative = path.relative(REPO_ROOT, resolved);
  const leavesRepo = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
  if (!leavesRepo) fail("Refusing to write passwords inside the repository (it is public). Choose a path outside it.");
  return resolved;
}

function databaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) fail("DATABASE_URL is not set (environment or .env)");
  const host = new URL(url).hostname;
  if (!LOCAL_DB_HOSTS.has(host) && process.env.TEST_LOGINS_ALLOW_REMOTE !== "1") {
    fail(`Refusing to change non-local database host "${host}" (set TEST_LOGINS_ALLOW_REMOTE=1 to override)`);
  }
  return url;
}

function render(logins: IssuedLogin[], host: string): string {
  const lines = logins.map((l) => `${l.email.padEnd(20)} ${l.password}   ${l.name} (${l.role})`);
  return [
    `GEDP test logins - database host ${host} - created ${new Date().toISOString()}`,
    "Synthetic accounts only. Running the script again replaces every password.",
    "",
    ...lines,
    "",
  ].join("\n");
}

function describeDbError(error: unknown): string {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return `A test AMEI or e-mail is already used by another employee (${JSON.stringify(error.meta?.target)}). Nothing was changed.`;
  }
  return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
  loadEnv();
  const target = outputPath();
  const url = databaseUrl();
  // Open the file BEFORE rotating passwords: if it cannot be written, nothing changes in the DB.
  const fd = openSync(target, "w", OWNER_ONLY);
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    let logins: IssuedLogin[];
    try {
      logins = await upsertTestLogins(db);
    } catch (error: unknown) {
      fail(describeDbError(error));
    }
    writeSync(fd, render(logins, new URL(url).hostname));
    console.info(`Created ${logins.length} test logins (${logins.map((l) => l.email).join(", ")}).`);
    console.info(`Passwords written to ${target} - move them to a password manager and delete the file.`);
  } finally {
    closeSync(fd);
    chmodSync(target, OWNER_ONLY); // also tightens a file that already existed (no-op on Windows)
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
