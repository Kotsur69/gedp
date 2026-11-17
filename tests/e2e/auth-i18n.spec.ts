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
  await dismissStartAnnouncement(page);
}

// HOME-01: the seed publishes a start announcement, so the first sign-in of a person opens a modal
// that makes the page inert. Whether it is still unseen depends on earlier runs against the same
// database. The <dialog> is server-rendered next to the greeting only while unseen, so its
// presence is known as soon as the greeting is; toBeVisible() then waits for hydration + showModal().
function startAnnouncement(page: Page) {
  return page.locator("dialog").filter({ hasText: /^(Komunikat|Announcement)/ });
}

/** Resolves once the Server Action that records the announcement as seen has answered OK. */
function announcementRecorded(page: Page) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && "next-action" in response.request().headers() && response.ok(),
  );
}

async function dismissStartAnnouncement(page: Page): Promise<void> {
  const dialog = startAnnouncement(page);
  if ((await dialog.count()) === 0) return;
  await expect(dialog).toBeVisible();
  const recorded = announcementRecorded(page);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await recorded;
}

test.describe("[HOME-01] start announcement", () => {
  test("is shown at most once per content version", async ({ page }) => {
    await page.goto("/login");
    const select = page.locator("select#employeeId:visible");
    // A person the language test does not use, so the parallel run does not close it first.
    const value = await select.evaluate((el: HTMLSelectElement) => {
      const options = [...el.options].filter((o) => o.value !== "" && !o.text.includes("("));
      return options[1]?.value ?? "";
    });
    expect(value, "seed has a second regular employee").not.toBe("");
    await select.selectOption(value);
    await page.locator("form:has(select#employeeId) button[type=submit]:visible").click();
    await expect(page.locator("h1#greeting:visible")).toBeVisible();

    // Unseen on a fresh database; earlier runs may already have recorded this person.
    const dialog = startAnnouncement(page);
    if ((await dialog.count()) > 0) {
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: "Komunikat" })).toBeVisible();
      await expect(dialog.getByRole("region", { name: "Komunikat" })).toBeFocused();
      const recorded = announcementRecorded(page);
      await dialog.getByRole("button", { name: "Rozumiem" }).click();
      await expect(dialog).toBeHidden();
      await recorded;
    }

    await page.reload();
    await expect(page.locator("h1#greeting:visible")).toBeVisible();
    await expect(startAnnouncement(page)).toHaveCount(0);
  });
});

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
