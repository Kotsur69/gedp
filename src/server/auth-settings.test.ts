import { describe, expect, it } from "vitest";
import { readAuthSettings } from "./auth-settings";

describe("readAuthSettings", () => {
  it("defaults to both test logins off and a 30 minute idle timeout", () => {
    expect(readAuthSettings({})).toEqual({
      devLogin: false,
      passwordLogin: false,
      idleMinutes: 30,
      sessionRefreshSeconds: 60,
    });
  });

  it("enables password login only for the exact string 'true', also in production", () => {
    expect(readAuthSettings({ AUTH_PASSWORD_LOGIN: "true" }).passwordLogin).toBe(true);
    expect(readAuthSettings({ AUTH_PASSWORD_LOGIN: "1" }).passwordLogin).toBe(false);
    const prodEnv = { NODE_ENV: "production", AUTH_SECRET: "x".repeat(32), AUTH_PASSWORD_LOGIN: "true" };
    expect(readAuthSettings(prodEnv).passwordLogin).toBe(true);
  });

  it("enables dev login only for the exact string 'true'", () => {
    expect(readAuthSettings({ AUTH_DEV_LOGIN: "true" }).devLogin).toBe(true);
    expect(readAuthSettings({ AUTH_DEV_LOGIN: "1" }).devLogin).toBe(false);
    expect(readAuthSettings({ AUTH_DEV_LOGIN: "TRUE" }).devLogin).toBe(false);
  });

  const SECRET = "x".repeat(32);
  const prod = { NODE_ENV: "production", AUTH_SECRET: SECRET };

  it("refuses dev login in production without the explicit override", () => {
    expect(() => readAuthSettings({ ...prod, AUTH_DEV_LOGIN: "true" })).toThrow(/refused in production/);
  });

  it("allows dev login in production with the override", () => {
    const env = { ...prod, AUTH_DEV_LOGIN: "true", AUTH_DEV_LOGIN_ALLOW_IN_PRODUCTION: "true" };
    expect(readAuthSettings(env).devLogin).toBe(true);
  });

  it("does not care about the override when dev login is off", () => {
    expect(readAuthSettings(prod).devLogin).toBe(false);
  });

  it.each([undefined, "", "x".repeat(31)])("refuses production runtime with AUTH_SECRET %s", (secret) => {
    expect(() => readAuthSettings({ NODE_ENV: "production", AUTH_SECRET: secret })).toThrow(/AUTH_SECRET/);
  });

  it("does not require AUTH_SECRET during next build or in development", () => {
    expect(() => readAuthSettings({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" })).not.toThrow();
    expect(() => readAuthSettings({ NODE_ENV: "development" })).not.toThrow();
  });

  it("accepts an idle timeout within 5..480 minutes", () => {
    expect(readAuthSettings({ AUTH_SESSION_IDLE_MINUTES: "5" }).idleMinutes).toBe(5);
    expect(readAuthSettings({ AUTH_SESSION_IDLE_MINUTES: "480" }).idleMinutes).toBe(480);
    expect(readAuthSettings({ AUTH_SESSION_IDLE_MINUTES: "" }).idleMinutes).toBe(30);
  });

  it.each(["4", "481", "15.5", "abc", "-30"])("rejects idle timeout %s", (value) => {
    expect(() => readAuthSettings({ AUTH_SESSION_IDLE_MINUTES: value })).toThrow(/AUTH_SESSION_IDLE_MINUTES/);
  });
});
