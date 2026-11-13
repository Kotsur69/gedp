import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// E-mail + password sign-in with the accounts from `npm run test-logins -- <file>`.
// E2E_LOGINS_FILE points at that file (CI creates it in the runner's temp dir); without it the
// suite is skipped, because passwords are never stored in the repository.
const loginsFile = process.env.E2E_LOGINS_FILE;

// Traces record typed values; failed CI runs upload test-results/ on a public repo.
test.use({ trace: "off", screenshot: "off", video: "off" });

function credentialsFor(email: string): { email: string; password: string } {
  const line = readFileSync(loginsFile ?? "", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${email} `));
  const password = line?.trim().split(/\s+/)[1];
  if (!password) throw new Error(`${email} not found in E2E_LOGINS_FILE`);
  return { email, password };
}

test.describe("password test accounts", () => {
  // Skips locally without the file; in CI a missing file fails loudly in credentialsFor().
  test.skip(!loginsFile && !process.env.CI, "E2E_LOGINS_FILE not set");

  test("a test account signs in with e-mail and password", async ({ page }) => {
    const anna = credentialsFor("test@example.com");
    await page.goto("/login");
    await page.locator("input#email:visible").fill(anna.email);
    await page.locator("input#password:visible").fill(anna.password);
    await page.locator("form:has(input#password) button[type=submit]:visible").click();
    await expect(page.locator("h1#greeting:visible")).toContainText("Anna");
  });

  test("a wrong password shows one generic error and no session", async ({ page }) => {
    const anna = credentialsFor("test@example.com");
    await page.goto("/login");
    await page.locator("input#email:visible").fill(anna.email);
    await page.locator("input#password:visible").fill(`${anna.password}x`);
    await page.locator("form:has(input#password) button[type=submit]:visible").click();
    // By id: Next's route announcer is also role="alert".
    await expect(page.locator("#login-error:visible")).toHaveText("Nieprawidłowy e-mail lub hasło.");
    await expect(page.locator("#login-error:visible")).toHaveAttribute("role", "alert");
    await expect(page.locator("input#email:visible")).toHaveAttribute("aria-invalid", "true");
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});
