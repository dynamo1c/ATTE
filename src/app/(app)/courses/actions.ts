"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { assessment, assessmentScheme, course, teachingAssignment, timetableSlot, courseOffering } from "@/db/schema";
import { canManageDepartment } from "@/lib/auth/permissions";
import { allowedComponents } from "@/lib/domain/timetable";
import { checkbox, int, oneOf, text } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";

const KINDS = ["INTEGRATED", "THEORY_ONLY", "PRACTICAL_ONLY", "SPECIALIZATION"] as const;

const fields = {
  departmentId: int("Department"),
  semester: int("Semester").refine((n) => n >= 1 && n <= 6, "Semester must be 1–6"),
  code: text("Subject code", 30).transform((v) => v.toUpperCase()),
  shortName: text("Short name", 30),
  name: text("Full name", 150),
  kind: oneOf(KINDS, "Type"),
  schemeId: int("Marks scheme"),
};

async function checkScheme(schemeId: number) {
  const [s] = await getDb().select({ id: assessmentScheme.id }).from(assessmentScheme).where(eq(assessmentScheme.id, schemeId));
  if (!s) throw new UserError("Choose a marks scheme.", { schemeId: ["Required"] });
}

export const createCourse = formAction(z.object(fields), async (input, { me }) => {
  ensure(canManageDepartment(me.actor, input.departmentId), "You can only add subjects to your own department.");
  await checkScheme(input.schemeId);
  await getDb().transaction(async (tx) => {
    const [row] = await tx.insert(course).values(input).returning();
    await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "course", entityId: row.id, after: row });
  });
  revalidatePath("/courses");
  return { ok: true, message: `${input.shortName} added. Add it to a class from the class page.` };
});

export const updateCourse = formAction(z.object({ id: int("Subject"), ...fields, active: checkbox() }), async ({ id, ...input }, { me }) => {
  const db = getDb();
  const [before] = await db.select().from(course).where(eq(course.id, id));
  if (!before) throw new UserError("Subject not found.");
  ensure(canManageDepartment(me.actor, before.departmentId) && canManageDepartment(me.actor, input.departmentId), "You can only edit your own department's subjects.");
  await checkScheme(input.schemeId);

  const offered = await db.select({ n: sql<number>`count(*)::int` }).from(courseOffering).where(eq(courseOffering.courseId, id));
  if (offered[0].n > 0 && (before.departmentId !== input.departmentId || before.semester !== input.semester)) {
    throw new UserError("This subject is already given to a class, so its department and semester can't change. Create a new subject instead.");
  }
  // Marks are stored against the scheme's tests: switching schemes would orphan them.
  if (before.schemeId !== input.schemeId) {
    const [tests] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(assessment)
      .innerJoin(courseOffering, eq(courseOffering.id, assessment.offeringId))
      .where(eq(courseOffering.courseId, id));
    if (tests.n > 0) throw new UserError("Marks have already been started for this subject, so its marks scheme can't change.", { schemeId: ["In use"] });
  }
  // Changing the type must not orphan timetable periods or teachers for a part that would no longer exist.
  const allowed = allowedComponents(input.kind);
  for (const part of ["THEORY", "PRACTICAL"] as const) {
    if (allowed.includes(part)) continue;
    const [slots] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(timetableSlot)
      .innerJoin(courseOffering, eq(courseOffering.id, timetableSlot.offeringId))
      .where(and(eq(courseOffering.courseId, id), eq(timetableSlot.component, part)));
    const [teachers] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(teachingAssignment)
      .innerJoin(courseOffering, eq(courseOffering.id, teachingAssignment.offeringId))
      .where(and(eq(courseOffering.courseId, id), eq(teachingAssignment.component, part)));
    if (slots.n + teachers.n > 0) {
      throw new UserError(`This subject still has ${part === "PRACTICAL" ? "lab" : "theory"} periods or teachers. Remove them first.`, { kind: ["In use"] });
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(course).set(input).where(eq(course.id, id));
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "course", entityId: id, before, after: input });
  });
  revalidatePath("/courses");
  revalidatePath(`/courses/${id}`);
  return { ok: true, message: "Saved." };
});
