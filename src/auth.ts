import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { authConfig, authSettings } from "@/auth.config";
import { DEV_LOGIN_PROVIDER_ID, PASSWORD_LOGIN_PROVIDER_ID } from "@/server/auth-settings";
import { db } from "@/server/db";
import { authenticateWithPassword } from "@/server/password-login";

// Login providers are chosen by configuration (ACC-03). Today only the dev picker exists;
// the production provider (Microsoft Entra ID or LDAP/AD, Q-01) is added to `providers` below
// when IT decides - the rest of the app only ever sees `auth()` and an e-mail address.

const devLoginInput = z.object({ employeeId: z.coerce.number().int().positive() });

const devLogin = Credentials({
  id: DEV_LOGIN_PROVIDER_ID,
  name: "Logowanie testowe",
  credentials: { employeeId: {} },
  async authorize(raw) {
    const parsed = devLoginInput.safeParse(raw);
    if (!parsed.success) return null;
    const employee = await db().employee.findUnique({
      where: { id: parsed.data.employeeId },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!employee) return null;
    // Inactive / non-White-Collar people can still sign in here: the access gate then shows
    // them the "no access" page, which is exactly what the picker is for when testing.
    return { id: String(employee.id), email: employee.email, name: `${employee.firstName} ${employee.lastName}` };
  },
});

// Test / demo accounts with a password (scripts/create-test-logins.ts).
const passwordLogin = Credentials({
  id: PASSWORD_LOGIN_PROVIDER_ID,
  name: "Password",
  credentials: { email: {}, password: {} },
  authorize: (raw) => authenticateWithPassword(db(), raw),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [...(authSettings.passwordLogin ? [passwordLogin] : []), ...(authSettings.devLogin ? [devLogin] : [])],
});
