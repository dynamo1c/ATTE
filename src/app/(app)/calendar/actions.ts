"use server";

import { and, eq, inArray, like, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { calendarDay, classGroup, classSession, courseOffering } from "@/db/schema";
import { canEditCalendar, type CalendarScope } from "@/lib/auth/permissions";
import { checkbox, date, int, oneOf, optionalInt, optionalText } from "@/lib/forms";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure, type CurrentStaff } from "@/server/current";
import { getClass } from "@/server/queries";

const calendarReasonPrefix = (calendarDayId: number) => `Calendar #${calendarDayId}:`;

async function parseScope(raw: string): Promise<{ scope: CalendarScope; departmentId: number | null; classGroupId: number | null }> {
  if (raw === "college") return { scope: { kind: "COLLEGE" }, departmentId: null, classGroupId: null };
  const m = /^(dept|class):(\d+)$/.exec(raw);
  if (!m) throw new UserError("Choose who this applies to.", { scope: ["Required"] });
  const idNum = Number(m[2]);
  if (m[1] === "dept") return { scope: { kind: "DEPARTMENT", departmentId: idNum }, departmentId: idNum, classGroupId: null };
  const c = await getClass(idNum);
  if (!c) throw new UserError("Class not found.");
  return { scope: { kind: "CLASS", classRef: c }, departmentId: null, classGroupId: idNum };
}

function checkAllowed(me: CurrentStaff, scope: CalendarScope) {
  ensure(canEditCalendar(me.actor, scope), "You can't change the calendar for that group.");
}

/** Sessions on `date` for the classes covered by a scope. */
function sessionsInScope(onDate: string, departmentId: number | null, classGroupId: number | null) {
  const classFilter = classGroupId
    ? sql`${courseOffering.classGroupId} = ${classGroupId}`
    : departmentId
      ? sql`${courseOffering.classGroupId} IN (SELECT id FROM ${classGroup} WHERE department_id = ${departmentId})`
      : sql`true`;
  return getDb()
    .select({ id: classSession.id, status: classSession.status })
    .from(classSession)
    .innerJoin(courseOffering, eq(courseOffering.id, classSession.offeringId))
    .where(and(eq(classSession.date, onDate), inArray(classSession.status, ["SCHEDULED", "HELD"]), classFilter));
}

export const addCalendarDay = formAction(
  z.object({
    date: date("Date"),
    type: oneOf(["HOLIDAY", "EXAM", "EVENT", "WORKING"], "Type"),
    followsWeekday: optionalInt(),
    scope: z.string(),
    note: optionalText(200),
    cancelClasses: checkbox(),
  }),
  async (input, { me }) => {
    const { scope, departmentId, classGroupId } = await parseScope(input.scope);
    checkAllowed(me, scope);
    if (input.followsWeekday !== null && (input.type !== "WORKING" || input.followsWeekday < 1 || input.followsWeekday > 6)) {
      throw new UserError("“Follow timetable of” only applies to working days (Mon–Sat).", { followsWeekday: ["Only for working days"] });
    }
    if ((input.type === "HOLIDAY" || input.type === "EXAM") && !input.note) {
      throw new UserError("Add a note so staff and parents know why (e.g. “Deepavali”).", { note: ["Required for holidays and exams"] });
    }

    const stopsClasses = input.type === "HOLIDAY" || input.type === "EXAM";
    const affected = stopsClasses ? await sessionsInScope(input.date, departmentId, classGroupId) : [];
    const marked = affected.filter((s) => s.status === "HELD").length;
    if (marked > 0 && !input.cancelClasses) {
      throw new UserError(`Attendance is already recorded for ${marked} class${marked === 1 ? "" : "es"} on this day. Tick “Cancel classes already recorded” to confirm. The marks are kept in history.`, {
        cancelClasses: ["Confirm to continue"],
      });
    }

    await getDb().transaction(async (tx) => {
      const [row] = await tx
        .insert(calendarDay)
        .values({ date: input.date, type: input.type, followsWeekday: input.followsWeekday, departmentId, classGroupId, note: input.note, createdBy: me.id })
        .returning();
      if (affected.length) {
        // The "Calendar #id:" prefix lets deleteCalendarDay restore exactly these sessions.
        await tx
          .update(classSession)
          .set({ status: "CANCELLED", statusReason: `${calendarReasonPrefix(row.id)} ${input.note ?? input.type}`, version: sql`${classSession.version} + 1` })
          .where(inArray(classSession.id, affected.map((s) => s.id)));
      }
      await audit(tx, { actorStaffId: me.id, action: "CREATE", entity: "calendar_day", entityId: row.id, after: { ...row, cancelledSessions: affected.length } });
    });
    revalidatePath("/calendar");
    return { ok: true, message: affected.length ? `Saved. ${affected.length} classes on that day were cancelled.` : "Saved." };
  },
);

export const deleteCalendarDay = formAction(z.object({ id: int("Entry") }), async ({ id }, { me }) => {
  const db = getDb();
  const [row] = await db.select().from(calendarDay).where(eq(calendarDay.id, id));
  if (!row) throw new UserError("Already removed.");
  const scope: CalendarScope = row.classGroupId
    ? { kind: "CLASS", classRef: (await getClass(row.classGroupId))! }
    : row.departmentId
      ? { kind: "DEPARTMENT", departmentId: row.departmentId }
      : { kind: "COLLEGE" };
  checkAllowed(me, scope);
  const restored = await db.transaction(async (tx) => {
    await tx.delete(calendarDay).where(eq(calendarDay.id, id));
    // Undo: classes this entry cancelled go back to how they were (marked → held, unmarked → scheduled).
    const back = await tx
      .update(classSession)
      .set({
        status: sql`CASE WHEN ${classSession.markedBy} IS NOT NULL THEN 'HELD'::session_status ELSE 'SCHEDULED'::session_status END`,
        statusReason: null,
        version: sql`${classSession.version} + 1`,
      })
      .where(and(eq(classSession.status, "CANCELLED"), like(classSession.statusReason, `${calendarReasonPrefix(id)}%`)))
      .returning({ id: classSession.id });
    await audit(tx, { actorStaffId: me.id, action: "DELETE", entity: "calendar_day", entityId: id, before: row, after: { restoredSessions: back.length } });
    return back.length;
  });
  revalidatePath("/calendar");
  return { ok: true, message: restored ? `Removed. ${restored} cancelled classes were restored.` : "Removed." };
});
