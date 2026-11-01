/**
 * Finds the automatic parent messages that are due and puts them in the outbox (docs/PLAN.md §8.1):
 * weekly summary, attendance below warning / minimum (once per drop), absent N days in a row,
 * absent a whole day. Safe to run any number of times: dedupe keys and the alert-state table make
 * a second run add nothing.
 *
 * No "server-only" import: `npm run notify:run` (scheduled) uses this.
 */
import { desc, eq, lte, sql } from "drizzle-orm";
import { inParallel, type DbOrTx } from "@/db/client";
import { classGroup, collegeSettings, studentAlertState, term } from "@/db/schema";
import { formatPercent, percent, type Outcome, type Standing } from "@/lib/domain/attendance";
import { addDays, type IsoDate } from "@/lib/domain/dates";
import { absenceStreak, alertStanding, attendanceAlert, dedupeKey, isAbsentDay, istParts, MIN_CLASSES_FOR_ALERT, weeklyWindow, WEEKLY_SEND_HOUR, type DayFact, type Trigger } from "@/lib/notify/rules";
import { groupMissed } from "@/lib/notify/templates";
import { isCurrent, loadClassAttendance, loadLeavePolicy, type ClassAttendance } from "../attendance-core";
import { enqueue, loadContacts, loadTriggerSettings, portalLink, prepare, type Draft } from "./outbox";

export interface ScanResult {
  queued: Partial<Record<Trigger, number>>;
  students: number;
  week: { from: IsoDate; to: IsoDate } | null;
}

const ATTENDED: ReadonlySet<Outcome> = new Set(["PRESENT", "LATE", "LEAVE_PRESENT"]);
const COVERED: ReadonlySet<Outcome> = new Set(["PRESENT", "LATE", "LEAVE_PRESENT", "LEAVE_EXCUSED", "LEAVE_ABSENT"]);
const MISSED: ReadonlySet<Outcome> = new Set(["ABSENT", "LEAVE_ABSENT"]);
const STREAK_LOOKBACK_DAYS = 21;
/** A run of absences must have reached at most this many days ago to alert (no alerts for old history on first run). */
const STREAK_RECENT_DAYS = 3;
// Serialises overlapping runs (two schedulers, or "Run now" during a scheduled run).
const SCAN_LOCK = 724_001;

export async function runScan(db: DbOrTx, opts: { now?: Date } = {}): Promise<ScanResult> {
  const now = opts.now ?? new Date();
  const { date: today, hour } = istParts(now);
  const [[settings], [currentTerm], triggers, policy] = await inParallel(db, [
    () => db.select().from(collegeSettings).where(eq(collegeSettings.id, 1)),
    () => db.select().from(term).where(lte(term.startsOn, today)).orderBy(desc(term.startsOn)).limit(1),
    () => loadTriggerSettings(db),
    () => loadLeavePolicy(db),
  ] as const);
  const result: ScanResult = { queued: {}, students: 0, week: null };
  if (!settings || !currentTerm || today > currentTerm.endsOn) return result;

  const week = triggers.WEEKLY_SUMMARY ? weeklyWindow(now) : null;
  result.week = week;
  const detailFrom = week && week.from < addDays(today, -STREAK_LOOKBACK_DAYS) ? week.from : addDays(today, -STREAK_LOOKBACK_DAYS);
  const rules = { minPct: settings.attendanceMinPct, warnPct: settings.attendanceWarnPct, policy };
  const link = portalLink();

  const classes = await db.select({ id: classGroup.id }).from(classGroup).where(eq(classGroup.termId, currentTerm.id));
  const loaded: ClassAttendance[] = [];
  for (let i = 0; i < classes.length; i += 4) {
    loaded.push(...(await inParallel(db, classes.slice(i, i + 4).map((c) => () => loadClassAttendance(db, c.id, rules, { today, detailFrom })))));
  }
  const classNames = new Map(
    (await db.execute<{ id: number; name: string }>(sql`SELECT cg.id, d.code || ' Sem ' || cg.semester AS name FROM class_group cg JOIN department d ON d.id = cg.department_id WHERE cg.term_id = ${currentTerm.id}`)).rows.map((r) => [r.id, r.name]),
  );
  const states = new Map(
    (await db.select({ studentId: studentAlertState.studentId, standing: studentAlertState.standing }).from(studentAlertState).where(eq(studentAlertState.termId, currentTerm.id))).map((r) => [r.studentId, r.standing as Standing]),
  );

  const drafts: Draft[] = [];
  const remember: { studentId: number; standing: Standing }[] = [];
  const dayCandidates = [addDays(today, -1), ...(hour >= WEEKLY_SEND_HOUR ? [today] : [])];

  for (const data of loaded) {
    const subjects = new Map(data.subjects.map((s) => [s.offeringId, s.shortName]));
    const className = classNames.get(data.classId) ?? "";
    for (const s of data.students) {
      if (!isCurrent(s)) continue;
      result.students++;
      const student = { name: s.name, regNo: s.regNo, className };
      const subjectLine = (o: { offeringId: number; total: Parameters<typeof percent>[0] }) => `${subjects.get(o.offeringId) ?? "?"} ${formatPercent(percent(o.total))}`;

      // 1. Attendance fell below warning / minimum — once per drop.
      const subjectStandings = s.attendance.byOffering.map((o) => ({ o, standing: s.subjectStanding.get(o.offeringId)!, counted: o.total.counted }));
      const decision = attendanceAlert(states.get(s.studentId) ?? null, alertStanding(subjectStandings));
      if (decision.remember) remember.push({ studentId: s.studentId, standing: decision.remember });
      if (decision.trigger && triggers[decision.trigger]) {
        const level: ReadonlySet<Standing> = decision.trigger === "ATTENDANCE_SHORTAGE" ? new Set(["SHORTAGE"]) : new Set(["AT_RISK", "SHORTAGE"]);
        const list = subjectStandings.filter((x) => x.counted >= MIN_CLASSES_FOR_ALERT && level.has(x.standing)).map((x) => subjectLine(x.o));
        const trigger = decision.trigger;
        drafts.push({
          trigger,
          studentId: s.studentId,
          data: { kind: trigger, student, subjects: list, minPct: rules.minPct, warnPct: rules.warnPct, link },
          key: (cid) => dedupeKey.standing(trigger, s.studentId, currentTerm.id, today, cid),
        });
      }

      const outcomes = s.outcomes ?? [];
      const days = dayFacts(outcomes);

      // 2. Weekly summary (Mon–Sat), only if something was entered that week.
      if (week) {
        const inWeek = outcomes.filter((o) => o.date >= week.from && o.date <= week.to);
        const counted = inWeek.filter((o) => ATTENDED.has(o.outcome) || MISSED.has(o.outcome));
        if (counted.length > 0) {
          drafts.push({
            trigger: "WEEKLY_SUMMARY",
            studentId: s.studentId,
            data: {
              kind: "WEEKLY_SUMMARY",
              student,
              weekFrom: week.from,
              weekTo: week.to,
              attended: counted.filter((o) => ATTENDED.has(o.outcome)).length,
              counted: counted.length,
              missed: groupMissed(inWeek.filter((o) => MISSED.has(o.outcome)).map((o) => ({ subject: subjects.get(o.offeringId) ?? "?", date: o.date }))),
              overall: formatPercent(percent(s.attendance.overall)),
              minPct: rules.minPct,
              short: s.attendance.byOffering.filter((o) => s.subjectStanding.get(o.offeringId) === "SHORTAGE").map(subjectLine),
              link,
            },
            key: (cid) => dedupeKey.weekly(s.studentId, week.from, cid),
          });
        }
      }

      // 3. Absent N working days in a row.
      if (triggers.CONSECUTIVE_ABSENCE && settings.consecutiveAbsenceDays > 0) {
        const streak = absenceStreak(days);
        if (streak && streak.days >= settings.consecutiveAbsenceDays && streak.to >= addDays(today, -STREAK_RECENT_DAYS)) {
          drafts.push({
            trigger: "CONSECUTIVE_ABSENCE",
            studentId: s.studentId,
            data: { kind: "CONSECUTIVE_ABSENCE", student, days: streak.days, from: streak.from, to: streak.to },
            key: (cid) => dedupeKey.streak(s.studentId, streak.from, cid),
          });
        }
      }

      // 4. Absent for a whole day (off by default).
      if (triggers.DAY_ABSENCE) {
        for (const d of days.filter((x) => dayCandidates.includes(x.date) && isAbsentDay(x))) {
          drafts.push({ trigger: "DAY_ABSENCE", studentId: s.studentId, data: { kind: "DAY_ABSENCE", student, date: d.date }, key: (cid) => dedupeKey.day(s.studentId, d.date, cid) });
        }
      }
    }
  }

  const contacts = await loadContacts(db, [...new Set(drafts.map((d) => d.studentId!))]);
  const rows = drafts.flatMap((d) => prepare(d, contacts.get(d.studentId!) ?? [], now));
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${SCAN_LOCK})`);
    for (let i = 0; i < remember.length; i += 1000) {
      const chunk = remember.slice(i, i + 1000);
      await tx
        .insert(studentAlertState)
        .values(chunk.map((r) => ({ studentId: r.studentId, termId: currentTerm.id, standing: r.standing, changedOn: today })))
        .onConflictDoUpdate({ target: [studentAlertState.studentId, studentAlertState.termId], set: { standing: sql`excluded.standing`, changedOn: sql`excluded.changed_on` } });
    }
    // Count per trigger from what was actually inserted (re-runs insert nothing).
    for (const trigger of new Set(rows.map((r) => r.trigger))) {
      const n = await enqueue(tx, rows.filter((r) => r.trigger === trigger));
      if (n) result.queued[trigger] = n;
    }
  });
  return result;
}

function dayFacts(outcomes: readonly { date: IsoDate; outcome: Outcome }[]): DayFact[] {
  const by = new Map<IsoDate, DayFact>();
  for (const o of outcomes) {
    const d = by.get(o.date) ?? { date: o.date, marked: 0, attended: 0, unmarked: 0 };
    if (o.outcome === "UNMARKED") d.unmarked++;
    else {
      d.marked++;
      if (COVERED.has(o.outcome)) d.attended++;
    }
    by.set(o.date, d);
  }
  return [...by.values()];
}

