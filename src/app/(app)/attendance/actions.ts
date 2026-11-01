"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { attendanceEditRequest, attendanceRecord, attendanceSubmission, classSession } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { canApproveForClass, canEditLockedAttendance } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/domain/dates";
import { diffMarks, lockState, type Mark } from "@/lib/domain/marking";
import { int, oneOf, optionalText, text } from "@/lib/forms";
import { formAction, toActionError, UserError } from "@/server/action";
import { getRoster, getSessionContext, sessionPermission, type SessionContext } from "@/server/attendance-data";
import { audit } from "@/server/audit";
import { ensure, requireStaff, type CurrentStaff } from "@/server/current";
import { getSettings } from "@/server/queries";

const markSchema = z.enum(["PRESENT", "ABSENT", "LATE"]);
const saveSchema = z.object({
  sessionId: z.number().int().positive(),
  version: z.number().int().nonnegative(),
  clientOpId: z.uuid(),
  marks: z.array(z.object({ studentId: z.number().int().positive(), mark: markSchema })).max(500),
  reason: z.string().trim().max(300).optional(),
});
export type SaveInput = z.input<typeof saveSchema>;
export type SaveResult = NonNullable<ActionState> & { version?: number; requested?: boolean };

async function loadForChange(me: CurrentStaff, sessionId: number) {
  const s = await getSessionContext(sessionId);
  if (!s) throw new UserError("This class no longer exists. Go back and reload.");
  ensure(sessionPermission(me.actor, s), "You can't take attendance for this class.");
  if (s.status === "CANCELLED") throw new UserError(`This class was cancelled${s.statusReason ? ` (${s.statusReason})` : ""}.`);
  const settings = await getSettings();
  const lock = lockState(s.date, todayIn(), settings.attendanceLockDays);
  if (lock === "FUTURE") throw new UserError("You can't take attendance for a class that hasn't happened yet.");
  return { s, lock, canOverride: canEditLockedAttendance(me.actor, s.classRef) };
}

/** Every expected student must have exactly one mark, and nobody else. */
async function validateMarks(s: SessionContext, marks: { studentId: number; mark: Mark }[]) {
  const roster = await getRoster(s);
  const expected = new Set(roster.map((r) => r.studentId));
  const given = new Map(marks.map((m) => [m.studentId, m.mark]));
  if (given.size !== marks.length) throw new UserError("A student appears twice. Reload the page and try again.");
  const missing = [...expected].filter((id) => !given.has(id));
  const extra = [...given.keys()].filter((id) => !expected.has(id));
  if (missing.length || extra.length) throw new UserError("The class list changed since you opened this page. Reload — your marks are kept as a draft.");
  const before = new Map(roster.filter((r) => r.mark).map((r) => [r.studentId, r.mark as Mark]));
  return { before, after: given };
}

/** Called directly from the marking screen (not a form). */
export async function saveAttendance(raw: SaveInput): Promise<SaveResult> {
  const me = await requireStaff();
  const parsed = saveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid data. Reload the page." };
  const input = parsed.data;
  try {
    const { s, lock, canOverride } = await loadForChange(me, input.sessionId);
    const { before, after } = await validateMarks(s, input.marks);
    const changes = diffMarks(before, after);

    if (lock === "LOCKED" && !canOverride) {
      // Edit window closed (including a class never marked in time): becomes a request for the HOD,
      // so late entries are always visible to them.
      if (!input.reason) throw new UserError("The edit window has closed. Give a reason so the HOD can approve the change.", { reason: ["Required"] });
      if (changes.length === 0) throw new UserError("Nothing changed.");
      await getDb().transaction(async (tx) => {
        const [req] = await tx
          .insert(attendanceEditRequest)
          .values({ sessionId: s.id, requestedBy: me.id, reason: input.reason!, changes, baseVersion: s.version })
          .returning({ id: attendanceEditRequest.id });
        await audit(tx, { actorStaffId: me.id, action: "REQUEST_EDIT", entity: "class_session", entityId: s.id, after: { requestId: req.id, changes } });
      });
      revalidatePath("/attendance/requests");
      return { ok: true, requested: true, message: "Sent to the HOD for approval. Attendance changes once approved." };
    }

    const version = await getDb().transaction(async (tx) => {
      // Idempotency: a retried request (same clientOpId) after a successful save is a no-op.
      const fresh = await tx.insert(attendanceSubmission).values({ clientOpId: input.clientOpId, sessionId: s.id, staffId: me.id }).onConflictDoNothing().returning();
      if (fresh.length === 0) return null;
      // Optimistic lock: refuse if someone saved after this screen was loaded.
      const [row] = await tx.select({ version: classSession.version }).from(classSession).where(eq(classSession.id, s.id)).for("update");
      if (row.version !== input.version) throw new UserError("Someone else saved this class's attendance just now. Reload to see it — your marks are kept as a draft.");
      if (changes.length) {
        await tx
          .insert(attendanceRecord)
          .values(changes.map((c) => ({ sessionId: s.id, studentId: c.studentId, status: c.to, markedBy: me.id, markedAt: new Date() })))
          .onConflictDoUpdate({
            target: [attendanceRecord.sessionId, attendanceRecord.studentId],
            set: { status: sql`excluded.status`, markedBy: sql`excluded.marked_by`, markedAt: sql`excluded.marked_at` },
          });
      }
      const [updated] = await tx
        .update(classSession)
        .set({ status: "HELD", statusReason: null, markedBy: me.id, markedAt: new Date(), version: sql`${classSession.version} + 1` })
        .where(eq(classSession.id, s.id))
        .returning({ version: classSession.version });
      await audit(tx, {
        actorStaffId: me.id,
        action: s.status === "HELD" ? "EDIT_ATTENDANCE" : "MARK_ATTENDANCE",
        entity: "class_session",
        entityId: s.id,
        after: { changes, lock, total: after.size },
        reason: input.reason ?? null,
      });
      return updated.version;
    });

    revalidatePath("/attendance");
    revalidatePath(`/attendance/${s.id}`);
    if (version === null) return { ok: true, message: "Already saved." };
    const absent = [...after.values()].filter((m) => m === "ABSENT").length;
    return { ok: true, version, message: `Saved: ${after.size - absent} present, ${absent} absent.` };
  } catch (e) {
    unstable_rethrow(e);
    return toActionError(e);
  }
}

export const markNotHeld = formAction(
  z.object({ sessionId: int("Class"), version: int("Version"), reason: text("Reason", 200) }),
  async ({ sessionId, version, reason }, { me }) => {
    const { s, lock, canOverride } = await loadForChange(me, sessionId);
    if (lock === "LOCKED" && !canOverride) throw new UserError("The edit window has closed. Ask the HOD to change this.");
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select({ version: classSession.version }).from(classSession).where(eq(classSession.id, s.id)).for("update");
      if (row.version !== version) throw new UserError("Someone else changed this class just now. Reload.");
      const removed = await tx.delete(attendanceRecord).where(eq(attendanceRecord.sessionId, s.id)).returning();
      await tx
        .update(classSession)
        .set({ status: "NOT_HELD", statusReason: reason, markedBy: me.id, markedAt: new Date(), version: sql`${classSession.version} + 1` })
        .where(eq(classSession.id, s.id));
      await audit(tx, { actorStaffId: me.id, action: "MARK_NOT_HELD", entity: "class_session", entityId: s.id, before: { status: s.status, records: removed.map((r) => ({ studentId: r.studentId, status: r.status })) }, reason });
    });
    revalidatePath("/attendance");
    revalidatePath(`/attendance/${sessionId}`);
    return { ok: true, message: "Marked as not held. It won't count in anyone's attendance." };
  },
);

export const reopenSession = formAction(z.object({ sessionId: int("Class"), version: int("Version") }), async ({ sessionId, version }, { me }) => {
  const { s, lock, canOverride } = await loadForChange(me, sessionId);
  if (s.status !== "NOT_HELD") throw new UserError("Only a class marked “not held” can be reopened.");
  if (lock === "LOCKED" && !canOverride) throw new UserError("The edit window has closed. Ask the HOD to change this.");
  await getDb().transaction(async (tx) => {
    const res = await tx
      .update(classSession)
      .set({ status: "SCHEDULED", statusReason: null, markedBy: null, markedAt: null, version: sql`${classSession.version} + 1` })
      .where(and(eq(classSession.id, s.id), eq(classSession.version, version)))
      .returning({ id: classSession.id });
    if (res.length === 0) throw new UserError("Someone else changed this class just now. Reload.");
    await audit(tx, { actorStaffId: me.id, action: "REOPEN_SESSION", entity: "class_session", entityId: s.id, before: { status: s.status, reason: s.statusReason } });
  });
  revalidatePath(`/attendance/${sessionId}`);
  return { ok: true, message: "Reopened. You can take attendance now." };
});

export const decideEditRequest = formAction(
  z.object({ requestId: int("Request"), decision: oneOf(["APPROVED", "REJECTED"], "Decision"), note: optionalText(300) }),
  async ({ requestId, decision, note }, { me }) => {
    const db = getDb();
    const [req] = await db.select().from(attendanceEditRequest).where(eq(attendanceEditRequest.id, requestId));
    if (!req || req.status !== "PENDING") throw new UserError("This request was already decided.");
    const s = await getSessionContext(req.sessionId);
    if (!s) throw new UserError("Class not found.");
    ensure(canApproveForClass(me.actor, s.classRef), "Only the HOD of this department or the admin can decide this.");
    if (decision === "APPROVED" && s.version !== req.baseVersion) {
      throw new UserError("Attendance for this class changed after the request was made. Reject it and ask the teacher to request again.");
    }
    const changes = req.changes as { studentId: number; from: Mark | null; to: Mark }[];
    await db.transaction(async (tx) => {
      const done = await tx
        .update(attendanceEditRequest)
        .set({ status: decision, decidedBy: me.id, decidedAt: new Date(), decisionNote: note })
        .where(and(eq(attendanceEditRequest.id, requestId), eq(attendanceEditRequest.status, "PENDING")))
        .returning({ id: attendanceEditRequest.id });
      if (done.length === 0) throw new UserError("This request was already decided.");
      if (decision === "APPROVED") {
        const [row] = await tx.select({ version: classSession.version }).from(classSession).where(eq(classSession.id, s.id)).for("update");
        if (row.version !== req.baseVersion) throw new UserError("Attendance changed meanwhile. Reject and ask for a new request.");
        await tx
          .insert(attendanceRecord)
          .values(changes.map((c) => ({ sessionId: s.id, studentId: c.studentId, status: c.to, markedBy: req.requestedBy })))
          .onConflictDoUpdate({ target: [attendanceRecord.sessionId, attendanceRecord.studentId], set: { status: sql`excluded.status`, markedBy: sql`excluded.marked_by`, markedAt: sql`now()` } });
        await tx
          .update(classSession)
          .set({ status: "HELD", markedBy: sql`coalesce(${classSession.markedBy}, ${req.requestedBy})`, markedAt: sql`coalesce(${classSession.markedAt}, now())`, version: sql`${classSession.version} + 1` })
          .where(eq(classSession.id, s.id));
      }
      await audit(tx, { actorStaffId: me.id, action: decision === "APPROVED" ? "APPROVE_EDIT" : "REJECT_EDIT", entity: "attendance_edit_request", entityId: requestId, after: { changes, note } });
    });
    revalidatePath("/attendance/requests");
    return { ok: true, message: decision === "APPROVED" ? "Approved and applied." : "Rejected." };
  },
);
