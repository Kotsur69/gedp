// Auth settings read from the environment. No `server-only` here: proxy.ts imports this too.
// Fails fast (throws at startup) on unsafe or invalid configuration.

export const DEV_LOGIN_PROVIDER_ID = "dev-login";

const DEFAULT_IDLE_MINUTES = 30;
const MIN_IDLE_MINUTES = 5;
const MAX_IDLE_MINUTES = 480;
// How often an active session's cookie is re-issued (sliding idle timeout).
const SESSION_REFRESH_SECONDS = 60;
// `npx auth secret` produces 32 random bytes; anyone holding the secret can mint any session.
const MIN_SECRET_LENGTH = 32;
const BUILD_PHASE = "phase-production-build";

export interface AuthSettings {
  /** "Sign in as a seeded employee" picker - local development and demos only. */
  devLogin: boolean;
  /** Session ends after this many minutes without a request (SEC-07). */
  idleMinutes: number;
  sessionRefreshSeconds: number;
}

type Env = Readonly<Record<string, string | undefined>>;

export function readAuthSettings(env: Env): AuthSettings {
  const devLogin = env.AUTH_DEV_LOGIN === "true";
  if (devLogin && env.NODE_ENV === "production" && env.AUTH_DEV_LOGIN_ALLOW_IN_PRODUCTION !== "true") {
    throw new Error(
      "AUTH_DEV_LOGIN=true is refused in production. Set AUTH_DEV_LOGIN_ALLOW_IN_PRODUCTION=true only for a demo deployment with synthetic data.",
    );
  }

  // Checked at production runtime only: `next build` (NEXT_PHASE) runs without runtime secrets.
  const isProductionRuntime = env.NODE_ENV === "production" && env.NEXT_PHASE !== BUILD_PHASE;
  if (isProductionRuntime && (env.AUTH_SECRET ?? "").length < MIN_SECRET_LENGTH) {
    throw new Error(`AUTH_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters in production (npx auth secret).`);
  }

  const rawIdle = env.AUTH_SESSION_IDLE_MINUTES;
  const idleMinutes = rawIdle === undefined || rawIdle === "" ? DEFAULT_IDLE_MINUTES : Number(rawIdle);
  if (!Number.isInteger(idleMinutes) || idleMinutes < MIN_IDLE_MINUTES || idleMinutes > MAX_IDLE_MINUTES) {
    throw new Error(
      `AUTH_SESSION_IDLE_MINUTES must be a whole number between ${MIN_IDLE_MINUTES} and ${MAX_IDLE_MINUTES}, got "${rawIdle}"`,
    );
  }

  return { devLogin, idleMinutes, sessionRefreshSeconds: SESSION_REFRESH_SECONDS };
}
