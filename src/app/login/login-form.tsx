"use client";

import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { loginAction } from "@/server/auth-actions";

export function LoginForm({ next }: { next: string }) {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Mobile number" name="phone">
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="username" placeholder="98450 12345" required autoFocus />
      </Field>
      <Field label="Password" name="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}
