"use server";

import { count, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { batchAssignment, parentContact, student } from "@/db/schema";
import { todayIn } from "@/lib/domain/dates";
import { checkbox, date, int, oneOf, optionalText, phone, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure, type CurrentStaff } from "@/server/current";
import { getCurrentTerm } from "@/server/queries";
import { canManageStudent, getStudent } from "@/server/student-data";

const MAX_CONTACTS = 4;

async function managedStudent(me: CurrentStaff, studentId: number) {
  const term = await getCurrentTerm();
  const s = await getStudent(studentId, term?.id ?? null);
  if (!s) throw new UserError("Student not found.");
  ensure(canManageStudent(me.actor, s), "Only the class teacher, HOD or admin can change this student.");
  return s;
}

const contactFields = {
  name: optionalText(120),
  relation: oneOf(["FATHER", "MOTHER", "GUARDIAN", "OTHER"], "Relation"),
  phone: phone("Mobile number"),
  language: oneOf(["BOTH", "KN", "EN"], "Language"),
  whatsappOk: checkbox(),
  consent: checkbox(),
  consentMethod: optionalText(120),
};

function consentValues(input: { consent: boolean; consentMethod: string | null }, existing?: { consentAt: Date | null; consentMethod: string | null }) {
  if (!input.consent) return { consentAt: null, consentMethod: null };
  if (!input.consentMethod) throw new UserError("Say how consent was given (e.g. “Signed admission form”).", { consentMethod: ["Required when consent is ticked"] });
  return { consentAt: existing?.consentAt ?? new Date(), consentMethod: input.consentMethod };
}

export const addContact = formAction(z.object({ studentId: int("Student"), ...contactFields }), async ({ studentId, consent, consentMethod, ...input }, { me }) => {
  await managedStudent(me, studentId);
  const db = getDb();
  const [n] = await db.select({ n: count() }).from(parentContact).where(eq(parentContact.studentId, studentId));
  if (n.n >= MAX_CONTACTS) throw new UserError(`A student can have at most ${MAX_CONTACTS} contact numbers.`);
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(parentContact).values({ studentId, ...input, ...consentValues({ consent, consentMethod }) }).returning();
    await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "parent_contact", entityId: row.id, after: row });
  });
  revalidatePath(`/students/${studentId}`);
  return { ok: true, message: "Contact added." };
});

export const updateContact = formAction(z.object({ id: int("Contact"), ...contactFields }), async ({ id, consent, consentMethod, ...input }, { me }) => {
  const db = getDb();
  const [before] = await db.select().from(parentContact).where(eq(parentContact.id, id));
  if (!before) throw new UserError("Contact not found.");
  await managedStudent(me, before.studentId);
  await db.transaction(async (tx) => {
    const values = { ...input, ...consentValues({ consent, consentMethod }, before) };
    await tx.update(parentContact).set(values).where(eq(parentContact.id, id));
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "parent_contact", entityId: id, before, after: values });
  });
  revalidatePath(`/students/${before.studentId}`);
  return { ok: true, message: "Saved." };
});

export const removeContact = formAction(z.object({ id: int("Contact") }), async ({ id }, { me }) => {
  const db = getDb();
  const [before] = await db.select().from(parentContact).where(eq(parentContact.id, id));
  if (!before) throw new UserError("Already removed.");
  await managedStudent(me, before.studentId);
  await db.transaction(async (tx) => {
    // If messages were already sent to this number the FK blocks deletion (history is kept) and the user is told.
    await tx.delete(parentContact).where(eq(parentContact.id, id));
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "parent_contact", entityId: id, before });
  });
  revalidatePath(`/students/${before.studentId}`);
  return { ok: true, message: "Contact removed." };
});

export const updateStudentProfile = formAction(
  z.object({
    studentId: int("Student"),
    name: text("Name", 120),
    gender: z.enum(["", "MALE", "FEMALE", "OTHER"]).transform((v) => (v === "" ? null : v)),
    dateOfBirth: z
      .string()
      .optional()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Invalid date"),
  }),
  async ({ studentId, ...values }, { me }) => {
    const s = await managedStudent(me, studentId);
    await getDb().transaction(async (tx) => {
      await tx.update(student).set(values).where(eq(student.id, studentId));
      await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "student", entityId: studentId, before: { name: s.name, gender: s.gender, dateOfBirth: s.dateOfBirth }, after: values });
    });
    revalidatePath(`/students/${studentId}`);
    return { ok: true, message: "Saved." };
  },
);

export const changeBatch = formAction(z.object({ studentId: int("Student"), batch: oneOf(["B1", "B2"], "Batch"), effectiveFrom: date("From date") }), async ({ studentId, batch, effectiveFrom }, { me }) => {
  const s = await managedStudent(me, studentId);
  if (!s.membership) throw new UserError("Student is not in a class this term.");
  // Backdating would silently re-assign classes already marked for the old batch.
  if (effectiveFrom < todayIn()) throw new UserError("Batch changes start today or later; past attendance stays with the old batch.", { effectiveFrom: ["Today or later"] });
  if (effectiveFrom < s.membership.joinedOn) throw new UserError("Date is before the student joined the class.", { effectiveFrom: ["Too early"] });
  await getDb().transaction(async (tx) => {
    await tx
      .insert(batchAssignment)
      .values({ membershipId: s.membership!.id, batch, effectiveFrom })
      .onConflictDoUpdate({ target: [batchAssignment.membershipId, batchAssignment.effectiveFrom], set: { batch } });
    await audit(tx, { actorStaffId: me.id, action: "CHANGE_BATCH", entity: "student", entityId: studentId, before: { batch: s.membership!.batch }, after: { batch, effectiveFrom } });
  });
  revalidatePath(`/students/${studentId}`);
  return { ok: true, message: `Moved to ${batch} from ${effectiveFrom}. Attendance % from that date counts ${batch} classes.` };
});
