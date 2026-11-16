import { describe, expect, it } from "vitest";
import { buildCsp, generateNonce, PATH_CSPS, STATIC_SECURITY_HEADERS } from "./security-headers";

const scriptSrc = (csp: string) => csp.split("; ").find((d) => d.startsWith("script-src")) ?? "";

describe("buildCsp", () => {
  it("production script-src allows only the nonce and strict-dynamic", () => {
    const script = scriptSrc(buildCsp("abc", false));
    expect(script).toBe("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(script).not.toMatch(/unsafe-inline|unsafe-eval/);
  });

  it("production style-src is nonce-only and upgrades insecure requests", () => {
    const csp = buildCsp("abc", false);
    expect(csp).toContain("style-src 'self' 'nonce-abc';");
    // Only style attributes are relaxed; script-src and style elements never are.
    expect(csp.replace("style-src-attr 'unsafe-inline'", "")).not.toMatch(/unsafe-inline/);
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("development adds unsafe-eval for React debugging only", () => {
    const csp = buildCsp("abc", true);
    expect(scriptSrc(csp)).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("forbids framing, plugins and foreign base/form targets", () => {
    const csp = buildCsp("abc", false);
    for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) {
      expect(csp).toContain(d);
    }
  });
});

describe("generateNonce", () => {
  it("is base64 and differs per call", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("PATH_CSPS", () => {
  it("locks down the paths the proxy skips: no scripts, no framing", () => {
    expect(PATH_CSPS.map((p) => p.source)).toEqual(["/brand/:path*", "/api/auth/:path*"]);
    for (const { csp } of PATH_CSPS) {
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).not.toContain("script-src");
    }
  });
});

describe("STATIC_SECURITY_HEADERS", () => {
  it("scopes HSTS to this host (no includeSubDomains without the domain owner)", () => {
    const hsts = STATIC_SECURITY_HEADERS.find((h) => h.key === "Strict-Transport-Security");
    expect(hsts?.value).toBe("max-age=63072000");
  });

  it("covers the baseline set", () => {
    expect(STATIC_SECURITY_HEADERS.map((h) => h.key)).toEqual([
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
    ]);
  });
});
