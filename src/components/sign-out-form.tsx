import { getTranslations } from "next-intl/server";
import { signOutAction } from "@/server/auth-actions";
import { SubmitButton } from "@/components/submit-button";

type SignOutFormProps = {
  variant?: "secondary" | "link";
};

export async function SignOutForm({ variant = "link" }: SignOutFormProps) {
  const t = await getTranslations("common");
  return (
    <form action={signOutAction}>
      <SubmitButton variant={variant} pendingLabel={t("signingOut")}>
        {t("signOut")}
      </SubmitButton>
    </form>
  );
}
