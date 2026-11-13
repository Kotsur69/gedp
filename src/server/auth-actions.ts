"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authSettings } from "@/auth.config";
import { signIn, signOut } from "@/auth";
import { DEV_LOGIN_PROVIDER_ID, PASSWORD_LOGIN_PROVIDER_ID } from "@/server/auth-settings";

const employeeIdInput = z.coerce.number().int().positive();

export async function devSignInAction(formData: FormData): Promise<void> {
  // The form is not rendered when dev login is off; a hand-crafted POST just goes back to /login.
  if (!authSettings.devLogin) redirect("/login");
  const employeeId = employeeIdInput.safeParse(formData.get("employeeId"));
  if (!employeeId.success) redirect("/login?error=invalid");
  try {
    await signIn(DEV_LOGIN_PROVIDER_ID, { employeeId: String(employeeId.data), redirectTo: "/" });
  } catch (error: unknown) {
    // signIn signals success with a redirect (re-thrown below); only real auth failures land here.
    if (error instanceof AuthError) redirect("/login?error=signin");
    throw error;
  }
}

const MAX_FIELD_LENGTH = 300;
const passwordInput = z.object({
  email: z.string().min(1).max(MAX_FIELD_LENGTH),
  password: z.string().min(1).max(MAX_FIELD_LENGTH),
});

export async function passwordSignInAction(formData: FormData): Promise<void> {
  if (!authSettings.passwordLogin) redirect("/login");
  const input = passwordInput.safeParse({ email: formData.get("email"), password: formData.get("password") });
  // One message for every failure, so the form never reveals which e-mails have accounts.
  if (!input.success) redirect("/login?error=credentials");
  try {
    await signIn(PASSWORD_LOGIN_PROVIDER_ID, { ...input.data, redirectTo: "/" });
  } catch (error: unknown) {
    if (!(error instanceof AuthError)) throw error; // includes Next's redirect on success
    if (error.type === "CredentialsSignin") redirect("/login?error=credentials");
    // Anything else (database down, hashing failure) is not a wrong password: log it, say so.
    console.error("Password sign-in failed:", error.type, error.cause ?? error.message);
    redirect("/login?error=signin");
  }
}

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
