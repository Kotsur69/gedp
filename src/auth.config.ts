import type { NextAuthConfig } from "next-auth";
import { readAuthSettings } from "@/server/auth-settings";

// Shared Auth.js config WITHOUT providers that touch the database, so proxy.ts can use it
// (proxy validates the session cookie and slides its expiry; it never queries Postgres).
// Reading the settings here makes a misconfiguration fail at startup.
export const authSettings = readAuthSettings(process.env);

export const authConfig = {
  providers: [],
  pages: { signIn: "/login" },
  session: {
    strategy: "jwt",
    // Idle timeout (SEC-07): the cookie expires `idleMinutes` after the last refresh.
    maxAge: authSettings.idleMinutes * 60,
    updateAge: authSettings.sessionRefreshSeconds,
  },
  callbacks: {
    // The token carries only the identity: `sub` = employee.id, set by Auth.js from the object a
    // provider returns. Every provider must resolve its own claim (e-mail, UPN, oid) to an employee
    // id at sign-in, so the per-request lookup is an exact primary-key match, never a fuzzy one.
    // Roles and flags are re-read from the database on every request (ACC-04).
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user && typeof token.sub === "string") session.user.id = token.sub;
      return session;
    },
  },
} satisfies NextAuthConfig;
