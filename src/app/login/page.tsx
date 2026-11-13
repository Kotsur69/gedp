import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authSettings } from "@/auth.config";
import { db } from "@/server/db";
import { getAccess } from "@/server/current-employee";
import { devSignInAction } from "@/server/auth-actions";
import { BrandCard } from "@/components/brand-card";
import { SubmitButton } from "@/components/submit-button";

// Layout and styling follow the AMSteel_Quote login (same company, shared brand layer).
// TODO(glossary): Polish labels are hard-coded until the glossary / next-intl lands.

const SIGN_IN_FAILED = "Nie udało się zalogować. Spróbuj ponownie.";
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  invalid: "Wybierz osobę z listy.",
  signin: SIGN_IN_FAILED,
  // Set by Auth.js itself when a credentials callback is rejected outside the server action.
  CredentialsSignin: SIGN_IN_FAILED,
};
const ERROR_ID = "login-error";
const HINT_ID = "login-hint";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

/** Own-key lookup only: `?error=constructor` must not resolve to Object.prototype members. */
function errorMessageFor(error: string | string[] | undefined): string | undefined {
  if (typeof error !== "string" || !Object.hasOwn(ERROR_MESSAGES, error)) return undefined;
  return ERROR_MESSAGES[error];
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  return (
    <BrandCard title="GEDP 2027" subtitle="Global Employee Development Program">
      <Suspense fallback={<p className="text-sm text-ink-soft">Ładowanie…</p>}>
        <LoginSection searchParams={searchParams} />
      </Suspense>
    </BrandCard>
  );
}

async function LoginSection({ searchParams }: LoginPageProps) {
  await connection();
  if ((await getAccess()).kind === "ok") redirect("/");

  if (!authSettings.devLogin) {
    return (
      <p className="rounded-xl bg-accent/7 px-4 py-3 text-sm leading-relaxed text-ink">
        Logowanie firmowe (SSO) zostanie włączone po decyzji działu IT.
      </p>
    );
  }

  const errorMessage = errorMessageFor((await searchParams).error);
  const employees = await db().employee.findMany({
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      isHrAdmin: true,
      isActive: true,
      isWhiteCollar: true,
      _count: { select: { directReports: true } },
    },
  });
  const describedBy = errorMessage ? `${ERROR_ID} ${HINT_ID}` : HINT_ID;

  return (
    <form action={devSignInAction} className="space-y-6">
      <div>
        <label htmlFor="employeeId" className="mb-2 block text-xs font-semibold tracking-wider text-ink-soft uppercase">
          Zaloguj jako
        </label>
        <select
          id="employeeId"
          name="employeeId"
          required
          defaultValue=""
          aria-invalid={errorMessage ? true : undefined}
          aria-describedby={describedBy}
          className="h-12 w-full cursor-pointer rounded-xl border border-line bg-white px-4 text-sm text-ink transition-colors focus:border-accent aria-invalid:border-danger"
        >
          <option value="" disabled>
            Wybierz osobę…
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {`${e.lastName} ${e.firstName}${describeFlags(e)}`}
            </option>
          ))}
        </select>
        <p id={HINT_ID} className="mt-2 text-xs leading-relaxed text-ink-soft">
          Środowisko testowe: dane syntetyczne, bez hasła. Osoby „nieaktywny” i „nie WC” zobaczą ekran braku
          dostępu.
        </p>
      </div>

      {errorMessage && (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
        >
          {errorMessage}
        </p>
      )}

      <SubmitButton pendingLabel="Logowanie…">Zaloguj</SubmitButton>
    </form>
  );
}

type EmployeeFlags = {
  isHrAdmin: boolean;
  isActive: boolean;
  isWhiteCollar: boolean;
  _count: { directReports: number };
};

function describeFlags(e: EmployeeFlags): string {
  const flags = [
    e.isHrAdmin && "HR",
    !e.isActive && "nieaktywny",
    !e.isWhiteCollar && "nie WC",
    e._count.directReports > 0 && `podwładni: ${e._count.directReports}`,
  ].filter(Boolean);
  return flags.length > 0 ? ` (${flags.join(", ")})` : "";
}
