import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";
import { changePasswordAction } from "@/server/auth-actions";
import { requireStaff } from "@/server/current";

export const metadata = { title: "Change password · MEI Attendance" };

export default async function ChangePasswordPage() {
  const me = await requireStaff({ allowPasswordChange: true });
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-slate-900">Change your password</h1>
        <p className="mt-1 text-sm text-slate-500">
          {me.mustChangePassword ? `Welcome, ${me.name}. Please set your own password before continuing.` : `Signed in as ${me.name}.`}
        </p>
        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <ActionForm action={changePasswordAction} className="space-y-4">
            <Field label="Current password" name="current">
              <Input id="current" name="current" type="password" autoComplete="current-password" />
            </Field>
            <Field label="New password" name="next" hint={`At least ${MIN_PASSWORD_LENGTH} characters, letters and numbers.`}>
              <Input id="next" name="next" type="password" autoComplete="new-password" />
            </Field>
            <Field label="Repeat new password" name="confirm">
              <Input id="confirm" name="confirm" type="password" autoComplete="new-password" />
            </Field>
            <SubmitButton className="w-full">Save password</SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-xs text-slate-500">Saving signs you out on all other devices.</p>
      </div>
    </main>
  );
}
