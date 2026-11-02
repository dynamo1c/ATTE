import "server-only";
/** Writes a checked import plan. Always called inside the import's transaction (see run.ts). */
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DbTx } from "@/db/client";
import { auditLog, batchAssignment, classMembership, course, courseOffering, parentContact, roleGrant, staff, student, teachingAssignment, timetableSlot, timetableVersion } from "@/db/schema";
import type { IsoDate } from "@/lib/domain/dates";
import type { StaffOp } from "@/lib/import/staff";
import type { StudentOp } from "@/lib/import/students";
import type { SubjectOp } from "@/lib/import/subjects";
import type { TimetableOp } from "@/lib/import/timetable";

type AuditEntry = { action: string; entity: string; entityId: string | number; before?: unknown; after?: unknown };

/** Collects audit rows and writes them in a few large inserts at the end. */
export class AuditBatch {
  private entries: AuditEntry[] = [];
  constructor(
    private actorStaffId: number,
    private reason: string,
  ) {}
  add(e: AuditEntry) {
    this.entries.push(e);
  }
  async flush(tx: DbTx) {
    for (let i = 0; i < this.entries.length; i += 500) {
      await tx.insert(auditLog).values(
        this.entries.slice(i, i + 500).map((e) => ({ actorStaffId: this.actorStaffId, action: e.action, entity: e.entity, entityId: String(e.entityId), before: e.before ?? null, after: e.after ?? null, reason: this.reason })),
      );
    }
  }
}

export async function applyStaff(tx: DbTx, ops: readonly StaffOp[], passwords: ReadonlyMap<string, string>, log: AuditBatch) {
  for (const op of ops) {
    let id: number;
    if (op.kind === "create") {
      const passwordHash = passwords.get(op.values.phone);
      if (!passwordHash) throw new Error(`No password prepared for ${op.values.phone}`);
      [{ id }] = await tx.insert(staff).values({ ...op.values, passwordHash, mustChangePassword: true }).returning({ id: staff.id });
      log.add({ action: "CREATE", entity: "staff", entityId: id, after: op.values });
    } else {
      id = op.id;
      if (Object.keys(op.set).length) {
        await tx.update(staff).set(op.set).where(eq(staff.id, id));
        log.add({ action: "UPDATE", entity: "staff", entityId: id, before: op.before, after: op.set });
      }
    }
    for (const g of op.grants) {
      const [row] = await tx.insert(roleGrant).values({ staffId: id, ...g }).onConflictDoNothing().returning({ id: roleGrant.id });
      if (row) log.add({ action: "GRANT_ROLE", entity: "role_grant", entityId: row.id, after: { staffId: id, ...g } });
    }
  }
}

async function offer(tx: DbTx, courseId: number, classGroupId: number, log: AuditBatch): Promise<number> {
  const [created] = await tx.insert(courseOffering).values({ courseId, classGroupId }).onConflictDoNothing().returning();
  if (created) {
    log.add({ action: "CREATE", entity: "course_offering", entityId: created.id, after: created });
    return created.id;
  }
  const [o] = await tx.select({ id: courseOffering.id }).from(courseOffering).where(and(eq(courseOffering.courseId, courseId), eq(courseOffering.classGroupId, classGroupId)));
  return o.id;
}

export async function applySubjects(tx: DbTx, ops: readonly SubjectOp[], log: AuditBatch) {
  for (const op of ops) {
    let id: number;
    if (op.kind === "create") {
      const [row] = await tx.insert(course).values(op.values).returning();
      id = row.id;
      log.add({ action: "CREATE", entity: "course", entityId: id, after: row });
    } else {
      id = op.id;
      if (Object.keys(op.set).length) {
        await tx.update(course).set(op.set).where(eq(course.id, id));
        log.add({ action: "UPDATE", entity: "course", entityId: id, before: op.before, after: op.set });
      }
    }
    if (op.offerTo) await offer(tx, id, op.offerTo, log);
  }
}

const CHUNK = 500;
async function chunked<T, R>(items: readonly T[], run: (chunk: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(...(await run(items.slice(i, i + CHUNK))));
  return out;
}

/** A whole college's first load is thousands of rows, so new rows go in as a few large inserts. */
export async function applyStudents(tx: DbTx, ops: readonly StudentOp[], termId: number, joinedOn: IsoDate, log: AuditBatch) {
  const now = new Date();
  const idOf = new Map<string, number>();
  const creates = ops.filter((op) => op.create);
  const created = await chunked(creates, (chunk) => tx.insert(student).values(chunk.map((op) => op.create!)).returning({ id: student.id, regNo: student.regNo }));
  for (const r of created) idOf.set(r.regNo, r.id);
  for (const op of creates) log.add({ action: "CREATE", entity: "student", entityId: idOf.get(op.regNo)!, after: op.create });
  const id = (op: StudentOp) => op.studentId ?? idOf.get(op.regNo)!;

  for (const op of ops) {
    if (!op.update) continue;
    await tx.update(student).set(op.update.set).where(eq(student.id, op.studentId!));
    log.add({ action: "UPDATE", entity: "student", entityId: op.studentId!, before: op.update.before, after: op.update.set });
  }

  const joins = ops.filter((op) => op.join);
  const members = await chunked(joins, (chunk) =>
    tx
      .insert(classMembership)
      .values(chunk.map((op) => ({ studentId: id(op), classGroupId: op.join!.classGroupId, termId, joinedOn })))
      .returning({ id: classMembership.id, studentId: classMembership.studentId }),
  );
  const memberOf = new Map(members.map((m) => [m.studentId, m.id]));
  await chunked(joins, (chunk) => tx.insert(batchAssignment).values(chunk.map((op) => ({ membershipId: memberOf.get(id(op))!, batch: op.join!.batch, effectiveFrom: joinedOn }))).returning({ id: batchAssignment.id }));
  for (const op of joins) log.add({ action: "JOIN_CLASS", entity: "student", entityId: id(op), after: { classGroupId: op.join!.classGroupId, batch: op.join!.batch, joinedOn } });

  const newContacts = ops.flatMap((op) =>
    op.addContacts.map((c) => ({ studentId: id(op), ...c, ...(op.consent ? { consentAt: now, consentMethod: op.consent } : { consentAt: null, consentMethod: null }) })),
  );
  const contactRows = await chunked(newContacts, (chunk) => tx.insert(parentContact).values(chunk).returning());
  for (const r of contactRows) log.add({ action: "CREATE", entity: "parent_contact", entityId: r.id, after: r });

  for (const op of ops) {
    for (const u of op.updateContacts) {
      await tx.update(parentContact).set(u.set).where(and(eq(parentContact.id, u.id), eq(parentContact.studentId, id(op))));
      log.add({ action: "UPDATE", entity: "parent_contact", entityId: u.id, before: u.before, after: u.set });
    }
    if (op.consent && op.consentContactIds.length) {
      const done = await tx
        .update(parentContact)
        .set({ consentAt: now, consentMethod: op.consent })
        .where(and(inArray(parentContact.id, op.consentContactIds), eq(parentContact.studentId, id(op)), isNull(parentContact.consentAt)))
        .returning({ id: parentContact.id });
      for (const d of done) log.add({ action: "CONSENT", entity: "parent_contact", entityId: d.id, after: { consentMethod: op.consent } });
    }
  }
}

export async function applyTimetable(tx: DbTx, ops: readonly TimetableOp[], approvedBy: number, note: string, log: AuditBatch) {
  for (const op of ops) {
    const offeringOf = new Map<number, number>();
    const existing = await tx.select({ id: courseOffering.id, courseId: courseOffering.courseId }).from(courseOffering).where(eq(courseOffering.classGroupId, op.classId));
    for (const o of existing) offeringOf.set(o.courseId, o.id);
    for (const courseId of op.offerCourseIds) offeringOf.set(courseId, await offer(tx, courseId, op.classId, log));

    let versionId: number;
    if (op.replaceVersionId) {
      versionId = op.replaceVersionId;
      // Checked unused (no class recorded) in this same transaction, so the slots can go.
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(timetableSlot).where(eq(timetableSlot.versionId, versionId));
      await tx.delete(timetableSlot).where(eq(timetableSlot.versionId, versionId));
      await tx.update(timetableVersion).set({ approvedBy, note }).where(eq(timetableVersion.id, versionId));
      log.add({ action: "REPLACE_SLOTS", entity: "timetable_version", entityId: versionId, before: { slots: n }, after: { slots: op.slots.length, note } });
    } else {
      const [v] = await tx.insert(timetableVersion).values({ classGroupId: op.classId, effectiveFrom: op.effectiveFrom, approvedBy, note }).returning({ id: timetableVersion.id });
      versionId = v.id;
      log.add({ action: "CREATE", entity: "timetable_version", entityId: versionId, after: { classId: op.classId, effectiveFrom: op.effectiveFrom, slots: op.slots.length, note } });
    }
    await tx.insert(timetableSlot).values(
      op.slots.map((s) => ({
        versionId,
        weekday: s.weekday,
        startPeriod: s.startPeriod,
        endPeriod: s.endPeriod,
        kind: s.kind,
        offeringId: s.courseId === null ? null : offeringOf.get(s.courseId)!,
        component: s.component,
        batchScope: s.batchScope,
        room: s.room,
      })),
    );
    for (const a of op.assign) {
      const [row] = await tx
        .insert(teachingAssignment)
        .values({ offeringId: offeringOf.get(a.courseId)!, component: a.component, batchScope: a.batchScope, staffId: a.staffId })
        .onConflictDoNothing()
        .returning();
      if (row) log.add({ action: "CREATE", entity: "teaching_assignment", entityId: row.id, after: row });
    }
  }
}
