/** Result of a form Server Action, shown by <ActionForm>. Shared by server and client. */
export type ActionState = {
  ok: boolean;
  message?: string;
  error?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** One-time values to show after success (e.g. a temporary password). */
  reveal?: { label: string; value: string };
  /** Follow-up link to show after success. */
  link?: { href: string; label: string };
} | null;
