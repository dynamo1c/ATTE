"use client";

import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card } from "@/components/ui";
import { setOptOutAction } from "@/server/parent-actions";

export function MessageSettings({ optedOut }: { optedOut: boolean }) {
  return (
    <Card title="WhatsApp messages · ವಾಟ್ಸಾಪ್ ಸಂದೇಶಗಳು">
      <p className="mb-3 text-sm text-slate-700">
        {optedOut
          ? "You get only urgent messages: attendance below the minimum, several days absent, and login codes."
          : "You get weekly attendance, marks and other college updates. Urgent messages always come."}
      </p>
      <ActionForm action={setOptOutAction}>
        <input type="hidden" name="optOut" value={optedOut ? "no" : "yes"} />
        <SubmitButton variant="secondary" size="sm">
          {optedOut ? "Get all updates again" : "Only urgent messages"}
        </SubmitButton>
      </ActionForm>
    </Card>
  );
}
