import { signOutAction } from "@/server/auth-actions";
import { SubmitButton } from "@/components/submit-button";

type SignOutFormProps = {
  variant?: "secondary" | "link";
};

export function SignOutForm({ variant = "link" }: SignOutFormProps) {
  return (
    <form action={signOutAction}>
      <SubmitButton variant={variant} pendingLabel="Wylogowywanie…">
        Wyloguj
      </SubmitButton>
    </form>
  );
}
