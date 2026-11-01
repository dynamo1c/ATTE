"use server";

import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { classSession, courseOffering, course, teachingAssignment, timetableSlot, timetableVersion } from "@/db/schema";
import { canManageClass } from "@/lib/auth/permissions";
import { addDays, todayIn } from "@/lib/domain/dates";
import { allowedComponents, findSlotConflicts, isVersionEditable, type SlotDef } from "@/lib/domain/timetable";
import { date, int, oneOf, optionalInt, optionalText } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { forgetGeneratedSessions } from "@/server/generate-sessions";
import { listSlots, listVersions, getOffering } from "@/server/class-data";
import { ensure, type CurrentStaff } from "@/server/current";
import { getClass } from "@/server/queries";

async function managedClass(me: CurrentStaff, classId: number) {
  const c = await getClass(classId);
  if (!c) throw new UserError("Class not found.");
  ensure(canManageClass(me.actor, c), "Only the HOD of this department or the admin can change this.");
  return c;
}

async function managedOffering(me: CurrentStaff, offeringId: number) {
  const o = await getOffering(offeringId);
  if (!o) throw new UserError("Subject not found for this class.");
  const c = await managedClass(me, o.classGroupId);
  return { offering: o, cls: c };
}

const refresh = (classId: number) => {
  // Timetable or subjects changed: the next page load must plan this class's sessions again.
  forgetGeneratedSessions([classId]);
  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/timetable`);
};

// --- Subjects offered & teachers ---------------------------------------------

export const addOffering = formAction(z.object({ classId: int("Class"), courseId: int("Subject") }), async ({ classId, courseId }, { me }) => {
  const c = await managedClass(me, classId);
  const [crs] = await getDb().select().from(course).where(eq(course.id, courseId));
  if (!crs || crs.departmentId !== c.departmentId || crs.semester !== c.semester) throw new UserError("That subject is not in this department's semester.");
  await getDb().transaction(async (tx) => {
    const [o] = await tx.insert(courseOffering).values({ courseId, classGroupId: classId }).returning();
    await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "course_offering", entityId: o.id, after: o });
  });
  refresh(classId);
  return { ok: true, message: `${crs.shortName} added to the class.` };
});

export const removeOffering = formAction(z.object({ offeringId: int("Subject") }), async ({ offeringId }, { me }) => {
  const { offering, cls } = await managedOffering(me, offeringId);
  const db = getDb();
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(classSession).where(eq(classSession.offeringId, offeringId));
  if (used.n > 0) throw new UserError(`${offering.shortName} already has ${used.n} classes recorded, so it can't be removed.`);
  await db.transaction(async (tx) => {
    await tx.delete(teachingAssignment).where(eq(teachingAssignment.offeringId, offeringId));
    await tx.delete(courseOffering).where(eq(courseOffering.id, offeringId));
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "course_offering", entityId: offeringId, before: offering });
  });
  refresh(cls.id);
  return { ok: true, message: `${offering.shortName} removed.` };
});

export const addAssignment = formAction(
  z.object({
    offeringId: int("Subject"),
    component: oneOf(["THEORY", "PRACTICAL"], "Part"),
    batchScope: oneOf(["ALL", "B1", "B2"], "Batch"),
    staffId: int("Teacher"),
  }),
  async (input, { me }) => {
    const { offering, cls } = await managedOffering(me, input.offeringId);
    if (!allowedComponents(offering.kind).includes(input.component)) {
      throw new UserError(`${offering.shortName} has no ${input.component === "PRACTICAL" ? "lab" : "theory"} part.`, { component: ["Not allowed for this subject"] });
    }
    await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(teachingAssignment).values(input).returning();
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "teaching_assignment", entityId: row.id, after: row });
    });
    refresh(cls.id);
    return { ok: true, message: "Teacher assigned." };
  },
);

export const removeAssignment = formAction(z.object({ assignmentId: int("Assignment") }), async ({ assignmentId }, { me }) => {
  const db = getDb();
  const [row] = await db.select().from(teachingAssignment).where(eq(teachingAssignment.id, assignmentId));
  if (!row) throw new UserError("Already removed.");
  const { cls } = await managedOffering(me, row.offeringId);
  await db.transaction(async (tx) => {
    await tx.delete(teachingAssignment).where(eq(teachingAssignment.id, assignmentId));
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "teaching_assignment", entityId: assignmentId, before: row });
  });
  refresh(cls.id);
  return { ok: true, message: "Teacher removed from this subject." };
});

// --- Timetable ---------------------------------------------------------------

async function editableVersion(me: CurrentStaff, versionId: number) {
  const [v] = await getDb().select().from(timetableVersion).where(eq(timetableVersion.id, versionId));
  if (!v) throw new UserError("Timetable version not found.");
  const cls = await managedClass(me, v.classGroupId);
  const info = (await listVersions(cls.id)).find((x) => x.id === v.id)!;
  if (!isVersionEditable(v, todayIn(), info.sessions)) {
    throw new UserError("This timetable already has classes recorded. To change it, start a new version from a future date.");
  }
  return { version: v, cls };
}

export const createVersion = formAction(
  z.object({ classId: int("Class"), effectiveFrom: date("Start date"), copyFrom: optionalInt(), note: optionalText(200) }),
  async ({ classId, effectiveFrom, copyFrom, note }, { me }) => {
    const cls = await managedClass(me, classId);
    const tomorrow = addDays(todayIn(), 1);
    if (effectiveFrom < tomorrow) throw new UserError("A new timetable must start tomorrow or later, so recorded classes keep their timetable.", { effectiveFrom: ["Tomorrow or later"] });
    const db = getDb();
    const [later] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(classSession)
      .innerJoin(courseOffering, eq(courseOffering.id, classSession.offeringId))
      .where(and(eq(courseOffering.classGroupId, classId), gte(classSession.date, effectiveFrom)));
    if (later.n > 0) throw new UserError("Classes already exist on or after that date. Choose a later start date.");

    const newId = await db.transaction(async (tx) => {
      const [v] = await tx.insert(timetableVersion).values({ classGroupId: classId, effectiveFrom, note, approvedBy: me.id }).returning();
      if (copyFrom) {
        const [src] = await tx.select().from(timetableVersion).where(eq(timetableVersion.id, copyFrom));
        if (!src || src.classGroupId !== classId) throw new UserError("Can only copy a timetable of the same class.");
        const slots = await tx.select().from(timetableSlot).where(eq(timetableSlot.versionId, copyFrom));
        if (slots.length) await tx.insert(timetableSlot).values(slots.map(({ id, versionId, ...s }) => ({ ...s, versionId: v.id })));
      }
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "timetable_version", entityId: v.id, after: { classId, effectiveFrom, copyFrom, note } });
      return v.id;
    });
    refresh(cls.id);
    return { ok: true, message: "New timetable version created. Edit it below.", link: { href: `/classes/${classId}/timetable?v=${newId}`, label: "Open the new version →" } };
  },
);

export const deleteVersion = formAction(z.object({ versionId: int("Version") }), async ({ versionId }, { me }) => {
  const { version, cls } = await editableVersion(me, versionId);
  const all = await listVersions(cls.id);
  if (all.length <= 1) throw new UserError("A class needs at least one timetable.");
  await getDb().transaction(async (tx) => {
    await tx.delete(timetableVersion).where(eq(timetableVersion.id, versionId)); // slots cascade
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "timetable_version", entityId: versionId, before: version });
  });
  refresh(cls.id);
  return { ok: true, message: "Timetable version deleted." };
});

export const addSlot = formAction(
  z.object({
    versionId: int("Version"),
    weekday: int("Day").refine((n) => n >= 1 && n <= 6, "Choose a day"),
    startPeriod: int("From period"),
    endPeriod: int("To period"),
    kind: oneOf(["CLASS", "ACTIVITY"], "Type"),
    offeringId: optionalInt(),
    component: oneOf(["THEORY", "PRACTICAL"], "Part"),
    batchScope: oneOf(["ALL", "B1", "B2"], "Batch"),
    room: optionalText(40),
  }),
  async (input, { me }) => {
    const { version, cls } = await editableVersion(me, input.versionId);
    if (input.endPeriod < input.startPeriod) throw new UserError("“To” period must be the same or after “From”.", { endPeriod: ["Must be ≥ From"] });

    let slot: Omit<SlotDef, "id"> & { room: string | null };
    if (input.kind === "ACTIVITY") {
      slot = { weekday: input.weekday, startPeriod: input.startPeriod, endPeriod: input.endPeriod, kind: "ACTIVITY", offeringId: null, component: null, batchScope: "ALL", room: input.room };
    } else {
      if (!input.offeringId) throw new UserError("Choose the subject.", { offeringId: ["Required"] });
      const o = await getOffering(input.offeringId);
      if (!o || o.classGroupId !== cls.id) throw new UserError("That subject is not offered to this class.");
      if (!allowedComponents(o.kind).includes(input.component)) throw new UserError(`${o.shortName} has no ${input.component === "PRACTICAL" ? "lab" : "theory"} part.`, { component: ["Not allowed"] });
      slot = { ...input, kind: "CLASS", offeringId: o.id, component: input.component };
    }

    // Same students can't be in two places.
    const existing = await listSlots(version.id);
    const candidate: SlotDef = { id: -1, ...slot };
    const clash = findSlotConflicts([...existing, candidate]).find((c) => c.a.id === -1 || c.b.id === -1);
    if (clash) {
      const other = clash.a.id === -1 ? clash.b : clash.a;
      const name = existing.find((e) => e.id === other.id)?.subject ?? "Activity period";
      throw new UserError(`Clashes with ${name} (${other.batchScope === "ALL" ? "whole class" : other.batchScope}) in the same period.`);
    }

    // Same teacher can't be in two classes at once (checked against every class's timetable in force on this version's start date).
    if (slot.kind === "CLASS") {
      const { rows } = await getDb().execute<{ teacher: string; dept: string; semester: number; subject: string }>(sql`
        WITH me_teachers AS (
          SELECT staff_id FROM teaching_assignment
          WHERE offering_id = ${slot.offeringId} AND component = ${slot.component} AND batch_scope IN ('ALL', ${slot.batchScope})
        ),
        active_versions AS (
          SELECT DISTINCT ON (v.class_group_id) v.id FROM timetable_version v
          WHERE v.effective_from <= ${version.effectiveFrom} AND v.class_group_id <> ${cls.id}
          ORDER BY v.class_group_id, v.effective_from DESC
        )
        SELECT s.name AS teacher, d.code AS dept, cg.semester, c.short_name AS subject
        FROM timetable_slot ts
        JOIN teaching_assignment ta ON ta.offering_id = ts.offering_id AND ta.component = ts.component AND ta.batch_scope IN ('ALL', ts.batch_scope)
        JOIN staff s ON s.id = ta.staff_id
        JOIN course_offering o ON o.id = ts.offering_id JOIN course c ON c.id = o.course_id
        JOIN class_group cg ON cg.id = o.class_group_id JOIN department d ON d.id = cg.department_id
        WHERE ts.version_id IN (SELECT id FROM active_versions)
          AND ts.weekday = ${slot.weekday} AND ts.start_period <= ${slot.endPeriod} AND ${slot.startPeriod} <= ts.end_period
          AND ta.staff_id IN (SELECT staff_id FROM me_teachers)
        LIMIT 1`);
      if (rows[0]) {
        const r = rows[0];
        throw new UserError(`${r.teacher} already teaches ${r.subject} to ${r.dept} Sem ${r.semester} at that time. Change the period or the teacher.`);
      }
    }

    await getDb().transaction(async (tx) => {
      const [row] = await tx.insert(timetableSlot).values({ ...slot, versionId: version.id }).returning();
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "timetable_slot", entityId: row.id, after: row });
    });
    refresh(cls.id);
    return { ok: true, message: "Added to timetable." };
  },
);

export const deleteSlot = formAction(z.object({ slotId: int("Slot") }), async ({ slotId }, { me }) => {
  const db = getDb();
  const [slot] = await db.select().from(timetableSlot).where(eq(timetableSlot.id, slotId));
  if (!slot) throw new UserError("Already removed.");
  const { cls } = await editableVersion(me, slot.versionId);
  await db.transaction(async (tx) => {
    await tx.delete(timetableSlot).where(inArray(timetableSlot.id, [slotId]));
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "timetable_slot", entityId: slotId, before: slot });
  });
  refresh(cls.id);
  return { ok: true, message: "Removed." };
});
