import { beforeEach, describe, expect, it, vi } from "vitest";

// Boundaries mocked: Next's redirect (throws like the real one), Auth.js and the env-driven settings.
// next-auth itself only loads inside Next, so its AuthError base class is stubbed too.
const mocks = vi.hoisted(() => ({
  settings: { devLogin: true },
  signIn: vi.fn(),
  signOut: vi.fn(),
  AuthError: class AuthError extends Error {},
}));

vi.mock("next-auth", () => ({ AuthError: mocks.AuthError }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("@/auth.config", () => ({ authSettings: mocks.settings }));
vi.mock("@/auth", () => ({ signIn: mocks.signIn, signOut: mocks.signOut }));

const { devSignInAction, signOutAction } = await import("./auth-actions");

const form = (employeeId: string | null): FormData => {
  const data = new FormData();
  if (employeeId !== null) data.set("employeeId", employeeId);
  return data;
};

describe("devSignInAction", () => {
  beforeEach(() => {
    mocks.settings.devLogin = true;
    mocks.signIn.mockReset();
    mocks.signOut.mockReset();
  });

  it("signs in the chosen employee and lands on the home page", async () => {
    mocks.signIn.mockRejectedValue(new Error("REDIRECT /")); // Auth.js signals success by redirecting.
    await expect(devSignInAction(form("42"))).rejects.toThrow("REDIRECT /");
    expect(mocks.signIn).toHaveBeenCalledWith("dev-login", { employeeId: "42", redirectTo: "/" });
  });

  it("refuses a hand-crafted POST when dev login is switched off", async () => {
    mocks.settings.devLogin = false;
    await expect(devSignInAction(form("42"))).rejects.toThrow("REDIRECT /login");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it.each([null, "", "abc", "0", "-3", "1.5"])("rejects employeeId %j without calling Auth.js", async (value) => {
    await expect(devSignInAction(form(value))).rejects.toThrow("REDIRECT /login?error=invalid");
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("turns an Auth.js rejection into the sign-in error message", async () => {
    mocks.signIn.mockRejectedValue(new mocks.AuthError("CredentialsSignin"));
    await expect(devSignInAction(form("42"))).rejects.toThrow("REDIRECT /login?error=signin");
  });

  it("does not swallow unexpected errors", async () => {
    mocks.signIn.mockRejectedValue(new Error("database down"));
    await expect(devSignInAction(form("42"))).rejects.toThrow("database down");
  });
});

describe("signOutAction", () => {
  it("signs out back to the login page", async () => {
    mocks.signOut.mockResolvedValue(undefined);
    await signOutAction();
    expect(mocks.signOut).toHaveBeenCalledWith({ redirectTo: "/login" });
  });
});
