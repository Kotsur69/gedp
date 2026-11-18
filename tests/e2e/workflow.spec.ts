import { expect as baseExpect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";
import {
  closeTestData,
  documentStatus,
  findHrAdmin,
  findPeerManager,
  findTeams,
  openCycleYear,
  ownDocumentId,
  prepareCompleteDocument,
  resetDocuments,
  type Person,
  type Team,
} from "./support/workflow-data";

// Document workflow end to end (WF-01..06, WF-08, slides 2 and 5) for the four roles: employee,
// N+1, N+2 and HR. Dev login on the synthetic seed; every scenario owns one seeded team and
// starts from a document state written by support/workflow-data.ts, so the scenarios are
// independent and repeat against the same database. Every wait is on something the page or the
// server says (a visible text, a server action response), never on elapsed time.
// React <Activity> keeps the previous route in the DOM (hidden): role queries skip hidden
// elements, id selectors carry :visible.

// Upper bounds, not delays: server actions against a remote dev database plus first-hit route
// compiles in `next dev`.
const expect = baseExpect.configure({ timeout: 20_000 });
const SCENARIO_TIMEOUT_MS = 180_000;

/** Scenario k uses team k; teams are disjoint, so no two scenarios share a document. */
const SCENARIO_TEAM = { approve: 0, returnAndFix: 1, validatorEdit: 2, urlTampering: 3, nPlus2: 4, hrRevert: 5 } as const;
const TEAM_COUNT = Object.keys(SCENARIO_TEAM).length;

const STATUS = {
  draft: "Szkic",
  inValidation: "Do walidacji",
  returned: "Zwrócony do poprawy",
  approved: "Zatwierdzony",
} as const;

async function teamFor(scenario: keyof typeof SCENARIO_TEAM): Promise<Team> {
  return (await findTeams(TEAM_COUNT))[SCENARIO_TEAM[scenario]];
}

type SignInAs = (person: Person) => Promise<Page>;

/** One browser context per role, so the employee, N+1, N+2 and HR keep separate sessions. */
const test = base.extend<{ signInAs: SignInAs }>({
  // `provide` is Playwright's `use` callback, renamed so the react-hooks lint rule leaves it alone.
  signInAs: async ({ browser }, provide) => {
    const contexts: BrowserContext[] = [];
    await provide(async (person) => {
      const context = await browser.newContext();
      contexts.push(context);
      return signIn(context, person);
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

async function signIn(context: BrowserContext, person: Person): Promise<Page> {
  const page = await context.newPage();
  await page.goto("/login");
  // The picker's option value is the employee id.
  await page.locator("select#employeeId:visible").selectOption(String(person.id));
  await page.locator("form:has(select#employeeId) button[type=submit]:visible").click();
  // The greeting means the session cookie is set. The start announcement (HOME-01) lives on the
  // home page only; every scenario continues with a full navigation, which leaves it behind.
  await expect(page.locator("h1#greeting:visible")).toBeVisible();
  return page;
}

/** Resolves when the next Server Action answers OK (its response, not a delay, ends the wait). */
function serverActionDone(page: Page): Promise<unknown> {
  return page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && "next-action" in response.request().headers() && response.ok(),
  );
}

function statusPanel(page: Page): Locator {
  return page.getByRole("region", { name: "Status dokumentu" });
}

async function expectStatus(page: Page, status: string): Promise<void> {
  await expect(statusPanel(page).getByText(status, { exact: true })).toBeVisible();
}

async function openTeamDocument(page: Page, documentId: number, owner: Person): Promise<void> {
  await page.goto(`/goal-centre/team/${documentId}`);
  await expect(page.getByRole("heading", { level: 1, name: `Dokument: ${owner.name}` })).toBeVisible();
}

async function approveAsValidator(page: Page): Promise<void> {
  await statusPanel(page).getByRole("button", { name: "Zatwierdź" }).click();
  await expect(statusPanel(page).getByText("Dokument zatwierdzony.")).toBeVisible();
  await expectStatus(page, STATUS.approved);
}

async function sendForValidation(page: Page): Promise<void> {
  await page.goto("/goal-centre");
  await expect(statusPanel(page).getByText("Wszystkie warunki wysłania są spełnione.")).toBeVisible();
  await statusPanel(page).getByRole("button", { name: "Wyślij do walidacji" }).click();
  await expect(statusPanel(page).getByText("Dokument wysłany do walidacji.")).toBeVisible();
  await expectStatus(page, STATUS.inValidation);
}

// ---------------------------------------------------------------------------
// Filling the document as the employee (slide 5: Parts 1-3 are the closing conditions)
// ---------------------------------------------------------------------------

async function acknowledgeGroupGoal(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: `Otwórz: ${title}` }).click();
  const dialog = page.getByRole("dialog", { name: title });
  await dialog.getByRole("button", { name: "Potwierdzam zapoznanie" }).click();
  await expect(dialog.getByText(/^Potwierdzono /)).toBeVisible();
  await dialog.getByRole("button", { name: "Zamknij" }).click();
  await expect(dialog).toBeHidden();
}

async function fillPart1(page: Page): Promise<void> {
  await page.goto("/goal-centre");
  await acknowledgeGroupGoal(page, "Cel przywództwa");
  await acknowledgeGroupGoal(page, "Wartości firmy w praktyce");

  const bhp = "Osobiste zaangażowanie w BHP";
  await page.getByRole("button", { name: `Otwórz: ${bhp}` }).click();
  const dialog = page.getByRole("dialog", { name: `${bhp} – Believe in Zero` });
  // A BHP goal without a commitment opens straight into the field.
  await dialog.locator("#commitment").fill("Codziennie sprawdzam stan osłon na swoim stanowisku.");
  await dialog.getByRole("button", { name: "Zapisz" }).click();
  await expect(dialog.getByText("Zapisano.")).toBeVisible();
  await dialog.getByRole("button", { name: "Zamknij" }).click();
  await expect(page.getByRole("button", { name: `Otwórz: ${bhp}` })).toContainText("Codziennie sprawdzam");
}

async function fillPart2(page: Page, title: string): Promise<void> {
  await page.goto("/goal-centre/performance");
  await page.getByRole("button", { name: "Dodaj cel wydajnościowy" }).click();
  const dialog = page.getByRole("dialog", { name: "Nowy cel wydajnościowy" });
  await dialog.locator("#performance-goal-title").fill(title);
  await dialog.locator("#performance-goal-description").fill("Skrócenie przestojów przy zmianie asortymentu.");
  // Target type defaults to "Tekst", so the target is free text.
  await dialog.locator("#performance-goal-target").fill("Poniżej 30 minut na przezbrojenie");
  await dialog.locator("#performance-goal-measures").fill("Średni czas przezbrojenia z raportu zmianowego");
  // Due date: open the calendar and take the day it focuses (always inside the cycle year).
  const dueDate = dialog.locator("#performance-goal-dueDate");
  await dueDate.click();
  await expect(dialog.locator("[role=grid] button:focus")).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(dueDate).not.toContainText("Wybierz datę");
  await dialog.locator("#performance-goal-weight").fill("100");

  const addToPlan = dialog.getByRole("button", { name: "Dodaj do planu" });
  await expect(addToPlan).toBeEnabled();
  await addToPlan.click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("article").filter({ hasText: title })).toContainText("Dodany do planu");
}

async function fillPart3(page: Page, actionTitle: string): Promise<void> {
  await page.goto("/goal-centre/development");
  await page.getByRole("button", { name: "Dodaj cel rozwojowy" }).click();
  const dialog = page.getByRole("dialog", { name: "Nowy cel rozwojowy" });
  await dialog.locator("#development-goal-developmentAreaId").selectOption({ label: "Obecna rola" });
  await dialog.locator("#development-goal-competencyId").selectOption({ label: "Innowacyjność" });
  await dialog.locator("#development-goal-actionTitle").fill(actionTitle);
  await dialog.locator("#development-goal-actionDescription").fill("Warsztaty i jedno wdrożenie na linii.");
  const year = await openCycleYear();
  await dialog.locator("#development-goal-startDate").fill(`${year}-03-01`);
  await dialog.locator("#development-goal-endDate").fill(`${year}-06-30`);
  await dialog.getByRole("button", { name: "Dodaj do planu" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Otwórz cel: Innowacyjność" })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

test.describe("[WF] document workflow for the four roles", () => {
  // One after another in one worker ("default" mode still runs the rest after a failure): six
  // parallel multi-user flows exhaust the dev Supabase session pooler, which then drops the app's
  // connections (Prisma P1017). The teams stay disjoint, so the order does not matter.
  test.describe.configure({ mode: "default", timeout: SCENARIO_TIMEOUT_MS });
  test.afterAll(closeTestData);

  test("1) employee fills Parts 1-3 and sends, N+1 approves, then only progress can change", async ({ signInAs }) => {
    const team = await teamFor("approve");
    await resetDocuments([team.employee]);
    const goalTitle = "E2E 1: skrócenie czasu przezbrojenia";

    const employee = await signInAs(team.employee);
    await fillPart1(employee);
    await fillPart2(employee, goalTitle);
    await fillPart3(employee, "Szkolenie z metody SMED");
    await sendForValidation(employee);
    const documentId = await ownDocumentId(team.employee);

    // N+1 finds the document in "Mój zespół" > "Dokumenty do walidacji" and approves it. (The
    // team list row below carries a link with the same name.)
    const manager = await signInAs(team.manager);
    await manager.goto("/goal-centre/team");
    const inbox = manager.getByRole("region", { name: /^Dokumenty do walidacji/ });
    await inbox.getByRole("link", { name: `Waliduj dokument: ${team.employee.name}` }).click();
    await expect(manager.getByRole("heading", { level: 1, name: `Dokument: ${team.employee.name}` })).toBeVisible();
    await expect(manager.getByText("Tryb walidacji").filter({ visible: true })).toBeVisible();
    await approveAsValidator(manager);
    expect(await documentStatus(documentId)).toBe("ZATWIERDZONY");

    // Approved: the employee sees it, and nothing but progress is editable any more.
    await employee.goto("/goal-centre");
    await expectStatus(employee, STATUS.approved);
    await expect(statusPanel(employee).getByText("W ciągu roku możesz aktualizować tylko postęp celów.")).toBeVisible();
    await expect(statusPanel(employee).getByRole("button", { name: "Wyślij do walidacji" })).toHaveCount(0);
    await employee.getByRole("button", { name: "Otwórz: Osobiste zaangażowanie w BHP" }).click();
    const bhp = employee.getByRole("dialog", { name: "Osobiste zaangażowanie w BHP – Believe in Zero" });
    await expect(bhp.getByRole("button", { name: "Zamknij" })).toBeVisible();
    await expect(bhp.getByRole("button", { name: "Edytuj" })).toHaveCount(0);

    await employee.goto("/goal-centre/performance");
    const card = employee.getByRole("article").filter({ hasText: goalTitle });
    const progress = card.getByRole("combobox", { name: `Postęp celu: ${goalTitle}` });
    await expect(progress).toBeVisible();
    await expect(employee.getByRole("button", { name: "Dodaj cel wydajnościowy" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: `Edytuj cel: ${goalTitle}` })).toHaveCount(0);
    await expect(card.getByRole("button", { name: `Usuń cel: ${goalTitle}` })).toHaveCount(0);

    await Promise.all([serverActionDone(employee), progress.selectOption("W_TRAKCIE")]);
    await employee.reload();
    await expect(card.getByRole("combobox", { name: `Postęp celu: ${goalTitle}` })).toHaveValue("W_TRAKCIE");
    await expect(card).toContainText("Postęp: W trakcie");
    // Opening the goal shows it read-only.
    await card.getByRole("button", { name: `Otwórz cel: ${goalTitle}` }).click();
    const view = employee.getByRole("dialog", { name: goalTitle });
    await expect(view.getByRole("button", { name: "Zamknij" })).toBeVisible();
    await expect(view.getByRole("button", { name: "Edytuj" })).toHaveCount(0);

    await employee.goto("/goal-centre/development");
    // Positive check first, so the absence below is checked on the rendered page.
    await expect(employee.getByRole("combobox", { name: /^Postęp celu: / })).toHaveCount(1);
    await expect(employee.getByRole("button", { name: "Dodaj cel rozwojowy" })).toHaveCount(0);
  });

  test("2) N+1 returns with a comment, employee fixes and resends, N+1 approves", async ({ signInAs }) => {
    const team = await teamFor("returnAndFix");
    const doc = await prepareCompleteDocument(team, "DO_WALIDACJI", "2");
    const comment = "Doprecyzuj opis celu: która linia i od kiedy.";
    const fixedDescription = "Linia 2, od marca: przezbrojenie poniżej 30 minut (poprawione).";

    const manager = await signInAs(team.manager);
    await openTeamDocument(manager, doc.documentId, team.employee);
    await statusPanel(manager).getByRole("button", { name: "Zwróć do poprawy" }).click();
    await statusPanel(manager).getByLabel("Komentarz do zwrotu").fill(comment);
    await statusPanel(manager).getByRole("button", { name: "Zwróć dokument" }).click();
    await expect(statusPanel(manager).getByText("Dokument zwrócony do poprawy.")).toBeVisible();
    await expectStatus(manager, STATUS.returned);

    // The employee sees the return and the comment, then corrects the goal.
    const employee = await signInAs(team.employee);
    await employee.goto("/goal-centre");
    await expectStatus(employee, STATUS.returned);
    await expect(statusPanel(employee).getByText(`Komentarz przełożonego: ${comment}`)).toBeVisible();

    await employee.goto("/goal-centre/performance");
    await employee.getByRole("button", { name: `Edytuj cel: ${doc.performanceGoalTitle}` }).click();
    const dialog = employee.getByRole("dialog", { name: doc.performanceGoalTitle });
    await dialog.locator("#performance-goal-description").fill(fixedDescription);
    // A goal already in the plan stays there: "Zapisz i zamknij" is its only save.
    await dialog.getByRole("button", { name: "Zapisz i zamknij" }).click();
    await expect(dialog).toBeHidden();

    await sendForValidation(employee);

    // N+1 sees the corrected goal and approves.
    await openTeamDocument(manager, doc.documentId, team.employee);
    await expect(manager.getByRole("region", { name: "Cele wydajnościowe" })).toContainText(fixedDescription);
    await approveAsValidator(manager);

    await employee.goto("/goal-centre");
    await expectStatus(employee, STATUS.approved);
    // WF-06: the history keeps the return with its comment.
    await expect(statusPanel(employee).getByText(`Komentarz: ${comment}`)).toBeVisible();
    expect(await documentStatus(doc.documentId)).toBe("ZATWIERDZONY");
  });

  test("3) N+1 edits a goal during validation and it is marked 'Zmieniony przez N+1'", async ({ signInAs }) => {
    const team = await teamFor("validatorEdit");
    const doc = await prepareCompleteDocument(team, "DO_WALIDACJI", "3");
    const changedDescription = "Zmiana N+1: przezbrojenie poniżej 25 minut na linii 1.";

    const manager = await signInAs(team.manager);
    await openTeamDocument(manager, doc.documentId, team.employee);
    const part2 = manager.getByRole("region", { name: "Cele wydajnościowe" });
    await expect(part2.getByText("Zmienione przez N+1: 0")).toBeVisible();
    await part2.getByRole("button", { name: `Zmień cel: ${doc.performanceGoalTitle}` }).click();
    const dialog = manager.getByRole("dialog", { name: doc.performanceGoalTitle });
    await dialog.locator("#performance-goal-description").fill(changedDescription);
    await dialog.getByRole("button", { name: "Zapisz i zamknij" }).click();
    await expect(dialog).toBeHidden();
    await expect(part2).toContainText(changedDescription);
    await expect(part2.getByText("Zmieniony przez N+1", { exact: true })).toBeVisible();
    await expect(part2.getByText("Zmienione przez N+1: 1")).toBeVisible();

    // The employee sees the marker on the goal and in the Part 2 counters.
    const employee = await signInAs(team.employee);
    await employee.goto("/goal-centre/performance");
    const card = employee.getByRole("article").filter({ hasText: doc.performanceGoalTitle });
    await expect(card.getByText("Zmieniony przez N+1", { exact: true })).toBeVisible();
    await expect(employee.getByText("Zmienione przez N+1: 1")).toBeVisible();
    await card.getByRole("button", { name: `Otwórz cel: ${doc.performanceGoalTitle}` }).click();
    await expect(employee.getByRole("dialog", { name: doc.performanceGoalTitle })).toContainText(changedDescription);
  });

  test("4) a peer cannot open another person's document by changing the ID in the URL", async ({ signInAs }) => {
    const team = await teamFor("urlTampering");
    const doc = await prepareCompleteDocument(team, "DO_WALIDACJI", "4");
    const peerManager = await findPeerManager(team);
    const url = `/goal-centre/team/${doc.documentId}`;

    // Control: the same URL works for the person who validates the document.
    const manager = await signInAs(team.manager);
    await openTeamDocument(manager, doc.documentId, team.employee);
    await expect(manager.getByRole("region", { name: "Cele wydajnościowe" })).toContainText(doc.performanceGoalTitle);

    // A colleague with the same N+1, and a team lead next to the N+1 (has a team, so passes the
    // "Mój zespół" tab gate), both get "not found" - never the document, never "forbidden".
    for (const intruder of [team.peer, peerManager]) {
      const page = await signInAs(intruder);
      await page.goto(url);
      await expect(page.getByText("This page could not be found.")).toBeVisible();
      await expect(page.getByText(team.employee.name)).toHaveCount(0);
      await expect(page.getByText(doc.performanceGoalTitle)).toHaveCount(0);
    }
    expect(await documentStatus(doc.documentId)).toBe("DO_WALIDACJI");
  });

  test("5) N+2 sees the document but cannot validate it", async ({ signInAs }) => {
    const team = await teamFor("nPlus2");
    const doc = await prepareCompleteDocument(team, "DO_WALIDACJI", "5");

    const nPlus2 = await signInAs(team.managerOfManager);
    // Level 2 below the N+2: the reports of their team leads.
    await nPlus2.goto("/goal-centre/team?level=2");
    const openLink = nPlus2.getByRole("link", { name: `Otwórz dokument: ${team.employee.name}` });
    await expect(openLink).toBeVisible();
    await expect(nPlus2.getByRole("link", { name: `Waliduj dokument: ${team.employee.name}` })).toHaveCount(0);
    await openLink.click();
    await expect(nPlus2.getByRole("heading", { level: 1, name: `Dokument: ${team.employee.name}` })).toBeVisible();

    await expect(nPlus2.getByText("Podgląd – tylko do odczytu").filter({ visible: true })).toBeVisible();
    await expectStatus(nPlus2, STATUS.inValidation);
    await expect(nPlus2.getByRole("region", { name: "Cele wydajnościowe" })).toContainText(doc.performanceGoalDescription);
    await expect(nPlus2.getByRole("button", { name: "Zatwierdź" })).toHaveCount(0);
    await expect(nPlus2.getByRole("button", { name: "Zwróć do poprawy" })).toHaveCount(0);
    await expect(nPlus2.getByRole("button", { name: /^Zmień cel: / })).toHaveCount(0);
    expect(await documentStatus(doc.documentId)).toBe("DO_WALIDACJI");
  });

  test("6) HR reverts an approved document with a reason", async ({ signInAs }) => {
    const team = await teamFor("hrRevert");
    const doc = await prepareCompleteDocument(team, "ZATWIERDZONY", "6");
    const hrAdmin = await findHrAdmin();
    const reason = "Zmiana zakresu obowiązków od kwietnia - cele do ponownego ustalenia.";

    const hr = await signInAs(hrAdmin);
    await hr.goto(`/admin/documents?q=${team.employee.amei}`);
    const row = hr.getByRole("row").filter({ hasText: team.employee.amei });
    await expect(row.getByText(STATUS.approved, { exact: true })).toBeVisible();
    await row.getByRole("button", { name: `Cofnij status dokumentu: ${team.employee.name}` }).click();

    const dialog = hr.getByRole("dialog", { name: team.employee.name });
    await dialog.getByRole("radio", { name: STATUS.draft }).check();
    await dialog.getByLabel("Powód cofnięcia").fill(reason);
    await dialog.getByRole("button", { name: "Cofnij status" }).click();
    await expect(hr.getByRole("status").filter({ hasText: `Cofnięto status: ${team.employee.name}` })).toHaveText(
      `Cofnięto status: ${team.employee.name} (${STATUS.approved} → ${STATUS.draft}).`,
    );
    await expect(row.getByText(STATUS.draft, { exact: true })).toBeVisible();
    // Checked after the refreshed row, i.e. after the dialog's close event: it must stay closed
    // (regression: it used to reopen when the close event met the still-pending save).
    await expect(dialog).toBeHidden();
    await expect(hr.locator("dialog[open]")).toHaveCount(0);
    expect(await documentStatus(doc.documentId)).toBe("SZKIC");

    // The employee gets the plan back as a draft, with HR's reason in the history.
    const employee = await signInAs(team.employee);
    await employee.goto("/goal-centre");
    await expectStatus(employee, STATUS.draft);
    await expect(statusPanel(employee).getByText(`${STATUS.approved} → ${STATUS.draft}`)).toBeVisible();
    await expect(statusPanel(employee).getByText(`Komentarz: ${reason}`)).toBeVisible();
    await expect(statusPanel(employee).getByRole("button", { name: "Wyślij do walidacji" })).toBeVisible();
  });
});
