import { expect, test, type Page } from "@playwright/test";

// Smoke path on synthetic seed data: dev login -> home -> PL/EN switch -> sign out.
// React <Activity> keeps the previous route in the DOM (hidden), hence the :visible selectors.

async function signInAsRegularEmployee(page: Page) {
  await page.goto("/login");
  const select = page.locator("select#employeeId:visible");
  // First person without flags: active, White Collar, not HR, no reports.
  const value = await select.evaluate((el: HTMLSelectElement) => {
    const option = [...el.options].find((o) => o.value !== "" && !o.text.includes("("));
    return option?.value ?? "";
  });
  expect(value, "seed has a regular employee").not.toBe("");
  await select.selectOption(value);
  await page.locator("form:has(select#employeeId) button[type=submit]:visible").click();
  await expect(page.locator("h1#greeting:visible")).toBeVisible();
}

test.describe("[NFR-01] language switch", () => {
  test("Polish by default, English on request, remembered across reloads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("html")).toHaveAttribute("lang", "pl");
    await expect(page.locator("button[type=submit]:visible").first()).toHaveText("Zaloguj");

    await signInAsRegularEmployee(page);
    await expect(page.locator("h1#greeting:visible")).toContainText("Witaj w panelu na rok 2027");

    await page.locator("button[aria-label=English]:visible").click();
    await expect(page.locator("h1#greeting:visible")).toContainText("Welcome to your 2027 dashboard");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("button[aria-label=English]:visible")).toHaveAttribute("aria-pressed", "true");
    // The language lives in a cookie, never in the URL.
    await expect(page).toHaveURL(/^https?:\/\/[^/]+\/$/);

    await page.reload();
    await expect(page.locator("h1#greeting:visible")).toContainText("Welcome to your 2027 dashboard");

    await page.locator("button[aria-label=Polski]:visible").click();
    await expect(page.locator("h1#greeting:visible")).toContainText("Witaj w panelu na rok 2027");

    await page.locator("button:visible", { hasText: "Wyloguj" }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the switch works before sign-in, on the login page", async ({ page }) => {
    await page.goto("/login");
    await page.locator("button[aria-label=English]:visible").click();
    await expect(page.locator("button[type=submit]:visible").first()).toHaveText("Sign in");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});
