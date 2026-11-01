import "server-only";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { formDataToObject } from "@/lib/forms";
import type { ActionState } from "@/lib/action-state";
import { ForbiddenError, requireStaff, type CurrentStaff } from "./current";

/** A rule violation the user can fix (shown as the form error). */
export class UserError extends Error {
  constructor(
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "UserError";
  }
}

/** Friendly messages for database constraint names (see src/db/schema.ts). */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  staff_phone_unique: "Another staff member already uses this phone number.",
  department_code_unique: "A department with this code already exists.",
  course_code_unique: "A subject with this code already exists.",
  course_dept_sem_short: "This department already has a subject with this short name in that semester.",
  course_offering_course_class: "This subject is already offered to the class.",
  teaching_assignment_unique: "This teacher is already assigned to that part of the subject.",
  role_grant_unique: "This person already has that role.",
  role_grant_scope: "That role needs a department (HOD) or a class (class teacher).",
  calendar_day_scope: "There is already a calendar entry for this date and scope. Delete it first.",
  timetable_version_class_from: "A timetable version already starts on that date.",
  parent_contact_student_phone: "This number is already saved for the student.",
  parent_contact_phone_format: "Enter a valid 10-digit Indian mobile number.",
  student_reg_no_unique: "A student with this register number already exists.",
  college_settings_warn_above_min: "Warning % must be at least the minimum %.",
  term_year_kind: "That term already exists for the academic year.",
};

function pgError(e: unknown): { code?: string; constraint?: string; detail?: string } | null {
  for (let cur: unknown = e, i = 0; cur && i < 4; cur = (cur as { cause?: unknown }).cause, i++) {
    const c = cur as { code?: unknown; constraint?: unknown };
    if (typeof c.code === "string" && /^[0-9A-Z]{5}$/.test(c.code)) return cur as { code?: string; constraint?: string };
  }
  return null;
}

export function toActionError(e: unknown): NonNullable<ActionState> {
  if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
  if (e instanceof ForbiddenError) return { ok: false, error: e.message };
  const pg = pgError(e);
  if (pg) {
    const friendly = pg.constraint ? CONSTRAINT_MESSAGES[pg.constraint] : undefined;
    if (friendly) return { ok: false, error: friendly };
    if (pg.code === "23505") return { ok: false, error: "This already exists." };
    if (pg.code === "23503") return { ok: false, error: "This is still in use, or refers to something that no longer exists." };
    if (pg.code === "23514") return { ok: false, error: "That value is not allowed." };
    if (pg.code === "40001") return { ok: false, error: "Someone else changed this at the same time. Please try again." };
  }
  console.error("Action failed", e);
  return { ok: false, error: "Something went wrong. Nothing was saved. Please try again." };
}

/**
 * Wraps a form Server Action: login check → input validation → handler → friendly errors.
 * Handlers must still check permissions with `ensure(...)` — this only checks you are logged in.
 */
export function formAction<S extends z.ZodType>(
  schema: S,
  handler: (input: z.output<S>, ctx: { me: CurrentStaff }) => Promise<ActionState | void>,
  opts: { allowPasswordChange?: boolean } = {},
) {
  return async (_prev: ActionState, formData: FormData): Promise<ActionState> => {
    const me = await requireStaff({ allowPasswordChange: opts.allowPasswordChange });
    const parsed = schema.safeParse(formDataToObject(formData));
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error);
      return { ok: false, error: flat.formErrors[0] ?? "Please fix the highlighted fields.", fieldErrors: flat.fieldErrors as Record<string, string[]> };
    }
    try {
      return (await handler(parsed.data, { me })) ?? { ok: true, message: "Saved." };
    } catch (e) {
      unstable_rethrow(e);
      return toActionError(e);
    }
  };
}
