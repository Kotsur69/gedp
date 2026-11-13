"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authSettings } from "@/auth.config";
import { signIn, signOut } from "@/auth";
import { DEV_LOGIN_PROVIDER_ID } from "@/server/auth-settings";

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

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
