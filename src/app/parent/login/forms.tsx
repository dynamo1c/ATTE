"use client";

import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Input } from "@/components/ui";
import { requestCodeAction, verifyCodeAction } from "@/server/parent-actions";

export function RequestCodeForm() {
  return (
    <ActionForm action={requestCodeAction} className="space-y-4">
      <Field label="Student register number · ವಿದ್ಯಾರ್ಥಿ ನೋಂದಣಿ ಸಂಖ್ಯೆ" name="regNo" hint="As on the college ID card, e.g. 204CS25012">
        <Input id="regNo" name="regNo" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="204CS25012" required autoFocus />
      </Field>
      <Field label="Your mobile number · ನಿಮ್ಮ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ" name="phone" hint="The number you gave the college at admission">
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="98450 12345" required />
      </Field>
      <SubmitButton className="w-full">Send login code</SubmitButton>
    </ActionForm>
  );
}

export function VerifyCodeForm() {
  return (
    <ActionForm action={verifyCodeAction} className="space-y-4">
      <Field label="6-digit code · 6 ಅಂಕಿಯ ಕೋಡ್" name="code">
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="••••••"
          className="text-center font-mono text-xl tracking-[0.4em]"
          required
          autoFocus
        />
      </Field>
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}
