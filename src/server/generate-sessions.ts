/**
 * Creates class sessions from timetables + calendar. Safe to run any number of times:
 * it only inserts sessions that don't exist yet, and the DB's UNIQUE(slot_id, date) is the final guard.
 *
 * Runs (1) lazily when someone opens attendance pages, for the classes they see, and
 * (2) nightly via `npm run sessions:generate` (cron / Task Scheduler) so the HOD's "not yet entered"
 * counts are right even for classes nobody opened.
 *
 * No "server-only" import: the nightly script imports this too.
 */
import { and, asc, eq, gte, inArray, isNotNull, lte } from "drizzle-orm";
import type { Db } from "@/db/client";
import { calendarDay, classGroup, classSession, term, timetableSlot, timetableVersion } from "@/db/schema";
import { resolveDay, type CalendarEntry } from "@/lib/domain/calendar";
import { dateRange, type IsoDate } from "@/lib/domain/dates";
import { planSessionsForDay, type VersionDef } from "@/lib/domain/timetable";

/**
 * Classes already generated through a date by this server process, so busy pages (dashboard, attendance
 * list) don't re-plan every class's whole term on every load. Cleared when a timetable or the calendar
 * changes, and trusted for 10 minutes at most (another server process may have changed things).
 */
const generatedThrough = new Map<number, { until: IsoDate; at: number }>();
const REUSE_MS = 10 * 60_000;

/** Call after changing a class's timetable (or the calendar, for all classes). */
export function forgetGeneratedSessions(classIds?: readonly number[]): void {
  if (!classIds) generatedThrough.clear();
  else for (const id of classIds) generatedThrough.delete(id);
}

/**
 * `reuse`: skip classes this process generated through `until` recently. Only for page loads on the
 * shared pool, never inside a transaction (a rollback would leave the memo wrong).
 */
export async function generateSessions(db: Db, opts: { classIds?: number[]; until: IsoDate; reuse?: boolean }): Promise<number> {
  const found = await db
    .select({ id: classGroup.id, departmentId: classGroup.departmentId, startsOn: term.startsOn, endsOn: term.endsOn })
    .from(classGroup)
    .innerJoin(term, eq(term.id, classGroup.termId))
    .where(and(lte(term.startsOn, opts.until), opts.classIds ? inArray(classGroup.id, opts.classIds.length ? opts.classIds : [-1]) : undefined));
  const now = Date.now();
  const classes = opts.reuse
    ? found.filter((c) => {
        const g = generatedThrough.get(c.id);
        return !(g && g.until >= opts.until && now - g.at < REUSE_MS);
      })
    : found;
  if (classes.length === 0) return 0;

  const minStart = classes.reduce((m, c) => (c.startsOn < m ? c.startsOn : m), classes[0].startsOn);
  const calendar: CalendarEntry[] = (
    await db.select().from(calendarDay).where(and(gte(calendarDay.date, minStart), lte(calendarDay.date, opts.until)))
  ).map((e) => ({ date: e.date, type: e.type, followsWeekday: e.followsWeekday, departmentId: e.departmentId, classGroupId: e.classGroupId, note: e.note }));

  let created = 0;
  for (const c of classes) {
    const to = c.endsOn < opts.until ? c.endsOn : opts.until;
    const versions = await loadVersions(db, c.id);
    if (versions.length === 0) continue;

    const planned = dateRange(c.startsOn, to).flatMap((date) => planSessionsForDay(resolveDay(date, calendar, { departmentId: c.departmentId, classGroupId: c.id }), versions));
    if (planned.length === 0) continue;
    const slotIds = [...new Set(planned.map((p) => p.slotId))];
    const existing = await db
      .select({ slotId: classSession.slotId, date: classSession.date })
      .from(classSession)
      .where(and(isNotNull(classSession.slotId), inArray(classSession.slotId, slotIds), gte(classSession.date, c.startsOn), lte(classSession.date, to)));
    const have = new Set(existing.map((e) => `${e.slotId}|${e.date}`));
    const missing = planned.filter((p) => !have.has(`${p.slotId}|${p.date}`));

    for (let i = 0; i < missing.length; i += 1000) {
      const rows = await db
        .insert(classSession)
        .values(missing.slice(i, i + 1000).map((p) => ({ ...p, source: "TIMETABLE" as const, status: "SCHEDULED" as const })))
        .onConflictDoNothing({ target: [classSession.slotId, classSession.date] })
        .returning({ id: classSession.id });
      created += rows.length;
    }
  }
  // Only after every class succeeded (an error above throws past this, so nothing is remembered wrongly).
  if (opts.reuse) for (const c of classes) generatedThrough.set(c.id, { until: opts.until, at: now });
  return created;
}

async function loadVersions(db: Db, classId: number): Promise<VersionDef[]> {
  const versions = await db.select().from(timetableVersion).where(eq(timetableVersion.classGroupId, classId)).orderBy(asc(timetableVersion.effectiveFrom));
  if (versions.length === 0) return [];
  const slots = await db.select().from(timetableSlot).where(inArray(timetableSlot.versionId, versions.map((v) => v.id)));
  return versions.map((v) => ({
    id: v.id,
    effectiveFrom: v.effectiveFrom,
    slots: slots
      .filter((s) => s.versionId === v.id)
      .map((s) => ({ id: s.id, weekday: s.weekday, startPeriod: s.startPeriod, endPeriod: s.endPeriod, kind: s.kind, offeringId: s.offeringId, component: s.component, batchScope: s.batchScope })),
  }));
}
