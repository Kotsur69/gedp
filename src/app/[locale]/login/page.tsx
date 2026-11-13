import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";
import { authSettings } from "@/auth.config";
import { db } from "@/server/db";
import { getAccess } from "@/server/current-employee";
import { devSignInAction, passwordSignInAction } from "@/server/auth-actions";
import { BrandCard } from "@/components/brand-card";
import { SubmitButton } from "@/components/submit-button";

// Layout and styling follow the AMSteel_Quote login (same company, shared brand layer).
// Which forms appear depends on configuration: e-mail + password for test accounts
// (AUTH_PASSWORD_LOGIN) and/or the synthetic-employee picker (AUTH_DEV_LOGIN, local only).

type LoginErrorKey = "invalid" | "signin" | "credentials";
const ERROR_KEYS: Readonly<Record<string, LoginErrorKey>> = {
  invalid: "invalid",
  signin: "signin",
  credentials: "credentials",
  // Set by Auth.js itself when a credentials callback is rejected outside the server action.
  CredentialsSignin: "signin",
};
const ERROR_ID = "login-error";
const HINT_ID = "login-hint";
const FIELD_CLASSES =
  "h-12 w-full rounded-xl border border-line bg-white px-4 text-sm text-ink transition-colors focus:border-accent aria-invalid:border-danger";
const LABEL_CLASSES = "mb-2 block text-xs font-semibold tracking-wider text-ink-soft uppercase";

type LoginPageProps = {
  searchParams: Promise<{ error?: string | string[] }>;
};

/** Own-key lookup only: `?error=constructor` must not resolve to Object.prototype members. */
function errorKeyFor(error: string | string[] | undefined): LoginErrorKey | undefined {
  if (typeof error !== "string" || !Object.hasOwn(ERROR_KEYS, error)) return undefined;
  return ERROR_KEYS[error];
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const t = await getTranslations("common");
  return (
    <BrandCard title={t("appName")} subtitle={t("programName")}>
      <Suspense fallback={<p className="text-sm text-ink-soft">{t("loading")}</p>}>
        <LoginSection searchParams={searchParams} />
      </Suspense>
    </BrandCard>
  );
}

async function LoginSection({ searchParams }: LoginPageProps) {
  await connection();
  if ((await getAccess()).kind === "ok") redirect("/");
  const t = await getTranslations("auth");

  if (!authSettings.passwordLogin && !authSettings.devLogin) {
    return <p className="rounded-xl bg-accent/7 px-4 py-3 text-sm leading-relaxed text-ink">{t("ssoPending")}</p>;
  }

  const errorKey = errorKeyFor((await searchParams).error);
  return (
    <div className="space-y-6">
      {errorKey && (
        <p
          id={ERROR_ID}
          role="alert"
          className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm font-semibold text-danger"
        >
          {t(`errors.${errorKey}`)}
        </p>
      )}
      {authSettings.passwordLogin && <PasswordForm hasError={errorKey === "credentials"} />}
      {authSettings.passwordLogin && authSettings.devLogin && (
        <div className="flex items-center gap-3 text-xs text-ink-soft" aria-hidden="true">
          <span className="h-px flex-1 bg-line" />
          {t("or")}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      {authSettings.devLogin && <DevPickerForm hasError={errorKey === "invalid" || errorKey === "signin"} />}
    </div>
  );
}

async function PasswordForm({ hasError }: { hasError: boolean }) {
  const t = await getTranslations("auth");
  const describedBy = hasError ? ERROR_ID : undefined;
  return (
    <form action={passwordSignInAction} className="space-y-4">
      <div>
        <label htmlFor="email" className={LABEL_CLASSES}>
          {t("email")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="username"
          spellCheck={false}
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={FIELD_CLASSES}
        />
      </div>
      <div>
        <label htmlFor="password" className={LABEL_CLASSES}>
          {t("password")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          maxLength={200}
          autoComplete="current-password"
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={FIELD_CLASSES}
        />
      </div>
      <p className="text-xs leading-relaxed text-ink-soft">{t("testAccountsHint")}</p>
      <SubmitButton pendingLabel={t("signingIn")}>{t("signIn")}</SubmitButton>
    </form>
  );
}

async function DevPickerForm({ hasError }: { hasError: boolean }) {
  const t = await getTranslations("auth");
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
  const describedBy = hasError ? `${ERROR_ID} ${HINT_ID}` : HINT_ID;
  const flagLabels: FlagLabels = {
    hr: t("flags.hr"),
    inactive: t("flags.inactive"),
    notWhiteCollar: t("flags.notWhiteCollar"),
    directReports: (count) => t("flags.directReports", { count }),
  };

  return (
    <form action={devSignInAction} className="space-y-6">
      <div>
        <label htmlFor="employeeId" className={LABEL_CLASSES}>
          {authSettings.passwordLogin ? t("quickSignIn") : t("signInAs")}
        </label>
        <select
          id="employeeId"
          name="employeeId"
          required
          defaultValue=""
          aria-invalid={hasError || undefined}
          aria-describedby={describedBy}
          className={`${FIELD_CLASSES} cursor-pointer`}
        >
          <option value="" disabled>
            {t("choosePerson")}
          </option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {`${e.lastName} ${e.firstName}${describeFlags(e, flagLabels)}`}
            </option>
          ))}
        </select>
        <p id={HINT_ID} className="mt-2 text-xs leading-relaxed text-ink-soft">
          {t("devHint")}
        </p>
      </div>
      <SubmitButton variant={authSettings.passwordLogin ? "secondary" : "primary"} pendingLabel={t("signingIn")}>
        {t("signIn")}
      </SubmitButton>
    </form>
  );
}

type EmployeeFlags = {
  isHrAdmin: boolean;
  isActive: boolean;
  isWhiteCollar: boolean;
  _count: { directReports: number };
};

type FlagLabels = {
  hr: string;
  inactive: string;
  notWhiteCollar: string;
  directReports: (count: number) => string;
};

function describeFlags(e: EmployeeFlags, labels: FlagLabels): string {
  const flags = [
    e.isHrAdmin && labels.hr,
    !e.isActive && labels.inactive,
    !e.isWhiteCollar && labels.notWhiteCollar,
    e._count.directReports > 0 && labels.directReports(e._count.directReports),
  ].filter(Boolean);
  return flags.length > 0 ? ` (${flags.join(", ")})` : "";
}
