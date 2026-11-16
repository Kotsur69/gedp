import { afterEach, describe, expect, it, vi } from "vitest";
import { assertNoPublicSecrets, readEnv, validateEnvAtStartup } from "./env";
import { assertEnvOrExit } from "./instrumentation-node";

const valid = { DATABASE_URL: "postgresql://u:p@h/db", AUTH_SECRET: "x".repeat(32) };

describe("readEnv", () => {
  it("accepts a complete environment and defaults NODE_ENV", () => {
    expect(readEnv(valid)).toEqual({ ...valid, NODE_ENV: "development" });
  });

  it.each(["DATABASE_URL", "AUTH_SECRET"])("fails fast when %s is missing", (name) => {
    expect(() => readEnv({ ...valid, [name]: undefined })).toThrow(new RegExp(name));
  });

  it("reports every missing variable in one error", () => {
    expect(() => readEnv({})).toThrow(/DATABASE_URL[\s\S]*AUTH_SECRET/);
  });

  it("requires a 32 character AUTH_SECRET in production only", () => {
    expect(() => readEnv({ ...valid, NODE_ENV: "production", AUTH_SECRET: "x".repeat(31) })).toThrow(/AUTH_SECRET/);
    expect(readEnv({ ...valid, NODE_ENV: "production" }).NODE_ENV).toBe("production");
    expect(readEnv({ ...valid, AUTH_SECRET: "short" }).AUTH_SECRET).toBe("short");
  });

  it("rejects an unknown NODE_ENV", () => {
    expect(() => readEnv({ ...valid, NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it.each([
    "NEXT_PUBLIC_AUTH_SECRET",
    "NEXT_PUBLIC_DATABASE_URL",
    "NEXT_PUBLIC_API_KEY",
    "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE",
    "NEXT_PUBLIC_SIGNING_KEY",
  ])("refuses %s: secrets never take the NEXT_PUBLIC_ prefix", (name) => {
    expect(() => readEnv({ ...valid, [name]: "v" })).toThrow(/NEXT_PUBLIC_/);
  });

  it("allows harmless NEXT_PUBLIC_ variables", () => {
    expect(() => readEnv({ ...valid, NEXT_PUBLIC_APP_NAME: "GEDP" })).not.toThrow();
  });
});

describe("assertNoPublicSecrets", () => {
  it("checks names only, so it works without runtime secrets", () => {
    expect(() => assertNoPublicSecrets({})).not.toThrow();
    expect(() => assertNoPublicSecrets({ NEXT_PUBLIC_DB_PASSWORD: "p" })).toThrow(/NEXT_PUBLIC_DB_PASSWORD/);
  });
});

describe("validateEnvAtStartup", () => {
  it("skips the runtime variables during next build", () => {
    expect(validateEnvAtStartup({ NEXT_PHASE: "phase-production-build" })).toBeUndefined();
  });

  it("still refuses secret-looking NEXT_PUBLIC_ names during next build", () => {
    expect(() =>
      validateEnvAtStartup({ NEXT_PHASE: "phase-production-build", NEXT_PUBLIC_API_TOKEN: "t" }),
    ).toThrow(/NEXT_PUBLIC_API_TOKEN/);
  });

  it("validates at runtime", () => {
    expect(() => validateEnvAtStartup({})).toThrow(/Invalid environment/);
  });
});

describe("assertEnvOrExit", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs the problems and exits with code 1 when a required variable is missing", () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("DATABASE_URL", "");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    assertEnvOrExit();

    expect(log).toHaveBeenCalledWith(expect.stringMatching(/DATABASE_URL/));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does nothing when the environment is valid", () => {
    vi.stubEnv("NEXT_PHASE", "");
    vi.stubEnv("DATABASE_URL", valid.DATABASE_URL);
    vi.stubEnv("AUTH_SECRET", valid.AUTH_SECRET);
    vi.stubEnv("NODE_ENV", "test");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    assertEnvOrExit();

    expect(exit).not.toHaveBeenCalled();
  });
});
