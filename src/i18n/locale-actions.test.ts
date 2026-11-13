import { beforeEach, describe, expect, it, vi } from "vitest";

const set = vi.fn();
vi.mock("next/headers", () => ({ cookies: async () => ({ set }) }));

const { setLocaleAction } = await import("./locale-actions");

describe("setLocaleAction (NFR-01)", () => {
  beforeEach(() => set.mockReset());

  it("stores a supported locale in an httpOnly cookie for a year", async () => {
    await setLocaleAction("en");
    expect(set).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "en",
      expect.objectContaining({ path: "/", maxAge: 31_536_000, sameSite: "lax", httpOnly: true }),
    );
  });

  it.each(["de", "", "EN", null, 1, { toString: () => "en" }])("rejects %j without writing a cookie", async (value) => {
    await expect(setLocaleAction(value)).rejects.toThrow("Unsupported locale");
    expect(set).not.toHaveBeenCalled();
  });
});
