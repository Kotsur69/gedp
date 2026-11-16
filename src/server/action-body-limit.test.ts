import { describe, expect, it } from "vitest";
import { DEFAULT_ACTION_BODY_BYTES, isOversizedServerAction } from "./action-body-limit";

function request(pathname: string, headers: Record<string, string>, method = "POST") {
  return { method, pathname, headers: new Headers(headers) };
}

const action = (length?: string) => ({ "next-action": "abc123", ...(length === undefined ? {} : { "content-length": length }) });

describe("isOversizedServerAction", () => {
  it("lets the HR import path send bodies above the default limit", () => {
    expect(isOversizedServerAction(request("/admin/import", action(String(10 * 1024 * 1024))))).toBe(false);
  });

  it("refuses a large action body anywhere else, e.g. the public login page", () => {
    expect(isOversizedServerAction(request("/login", action(String(DEFAULT_ACTION_BODY_BYTES + 1))))).toBe(true);
  });

  it("allows normal action bodies up to the default limit", () => {
    expect(isOversizedServerAction(request("/login", action(String(DEFAULT_ACTION_BODY_BYTES))))).toBe(false);
  });

  it.each([undefined, "", "12abc", "-1"])("refuses an action without a usable Content-Length (%j)", (length) => {
    expect(isOversizedServerAction(request("/", action(length)))).toBe(true);
  });

  it("ignores requests that are not Server Actions", () => {
    expect(isOversizedServerAction(request("/login", { "content-length": "99999999" }))).toBe(false);
    expect(isOversizedServerAction(request("/login", action("99999999"), "GET"))).toBe(false);
  });

  it("matches the import path exactly, not by prefix", () => {
    expect(isOversizedServerAction(request("/admin/import-x", action("2000000")))).toBe(true);
  });
});
