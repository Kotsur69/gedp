// Validated environment, loaded at startup (src/instrumentation.ts) so a missing or malformed
// variable stops the server before it serves a request. Per-feature knobs (auth switches,
// header links) keep their own readers; this file owns the variables the app cannot run without.
// No `server-only`: instrumentation and unit tests load it directly.
import { z } from "zod";

const BUILD_PHASE = "phase-production-build";
// `npx auth secret` produces 32 random bytes; anyone holding the secret can mint any session.
const MIN_PRODUCTION_SECRET_LENGTH = 32;
// A NEXT_PUBLIC_ variable is inlined into the browser bundle, so it must never carry these.
const SECRET_NAME =
  /SECRET|PASSWORD|TOKEN|PRIVATE|CREDENTIAL|SERVICE_ROLE|_KEY$|API_?KEY|DATABASE_URL|CONNECTION_STRING/i;

const serverSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "is required (PostgreSQL connection string)"),
  AUTH_SECRET: z.string().min(1, "is required (generate with: npx auth secret)"),
});

export type Env = z.infer<typeof serverSchema>;
type Source = Readonly<Record<string, string | undefined>>;

function publicSecretProblems(source: Source): string[] {
  return Object.keys(source)
    .filter((name) => name.startsWith("NEXT_PUBLIC_") && SECRET_NAME.test(name))
    .map((name) => `${name}: server-only secrets must not use the NEXT_PUBLIC_ prefix`);
}

function invalidEnvironment(problems: readonly string[]): Error {
  return new Error(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
}

/**
 * Name-only check, safe without runtime secrets. next.config.ts runs it at build time too,
 * because that is when Next inlines NEXT_PUBLIC_ values into the shipped JavaScript.
 */
export function assertNoPublicSecrets(source: Source = process.env): void {
  const problems = publicSecretProblems(source);
  if (problems.length > 0) throw invalidEnvironment(problems);
}

/** Throws one error listing every problem. Pure: pass `process.env` or a fixture. */
export function readEnv(source: Source): Env {
  const problems = publicSecretProblems(source);

  const parsed = serverSchema.safeParse(source);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) problems.push(`${issue.path.join(".")}: ${issue.message}`);
  } else if (
    parsed.data.NODE_ENV === "production" &&
    parsed.data.AUTH_SECRET.length < MIN_PRODUCTION_SECRET_LENGTH
  ) {
    problems.push(`AUTH_SECRET: must be at least ${MIN_PRODUCTION_SECRET_LENGTH} characters in production`);
  }

  // `!parsed.success` always added a problem; it is repeated only to narrow the type below.
  if (problems.length > 0 || !parsed.success) throw invalidEnvironment(problems);
  return parsed.data;
}

/**
 * `next build` runs without runtime secrets, so only the name check runs in that phase.
 * Assumes `next start` sets NODE_ENV=production (it does), which arms the production rules.
 */
export function validateEnvAtStartup(source: Source = process.env): Env | undefined {
  if (source.NEXT_PHASE === BUILD_PHASE) {
    assertNoPublicSecrets(source);
    return undefined;
  }
  return readEnv(source);
}
