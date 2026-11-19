import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTheme } from "./config";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

const { setThemeAction } = await import("./theme-actions");

describe("resolveTheme", () => {
  it.each(["light", "dark", "system"] as const)("keeps the supported choice %s", (theme) => {
    expect(resolveTheme(theme)).toBe(theme);
  });

  it.each([undefined, "", "DARK", "sepia"])("falls back to light for %j", (value) => {
    expect(resolveTheme(value)).toBe("light");
  });
});

describe("setThemeAction", () => {
  beforeEach(() => set.mockReset());

  it("stores a supported theme in an httpOnly cookie for a year", async () => {
    await setThemeAction("dark");
    expect(set).toHaveBeenCalledWith(
      "GEDP_THEME",
      "dark",
      expect.objectContaining({ path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true }),
    );
  });

  it.each(["sepia", "", "Dark", null, 1, { toString: () => "dark" }])(
    "rejects %j without writing a cookie",
    async (value) => {
      await expect(setThemeAction(value)).rejects.toThrow("Unsupported theme");
      expect(set).not.toHaveBeenCalled();
    },
  );
});
