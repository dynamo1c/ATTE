/**
 * Parent-message rules (docs/PLAN.md §8). Pure functions only — every rule here has unit tests.
 */
import { addDays, type IsoDate } from "../domain/dates";
import type { Standing } from "../domain/attendance";

export type Trigger =
  | "WEEKLY_SUMMARY"
  | "ATTENDANCE_WARNING"
  | "ATTENDANCE_SHORTAGE"
  | "CONSECUTIVE_ABSENCE"
  | "DAY_ABSENCE"
  | "MARKS_PUBLISHED"
  | "LOW_MARKS"
  | "EXAM_SCHEDULE"
  | "BROADCAST"
  | "LEAVE_RECORDED"
  | "ELIGIBILITY_WARNING"
  | "LOGIN_OTP";

export type Channel = "WHATSAPP" | "SMS";

/** Switched on unless the college turns them off (the plan's defaults; [OPEN] ones chosen conservatively). */
export const TRIGGER_DEFAULT: Record<Trigger, boolean> = {
  WEEKLY_SUMMARY: true,
  ATTENDANCE_WARNING: true,
  ATTENDANCE_SHORTAGE: true,
  CONSECUTIVE_ABSENCE: true,
  DAY_ABSENCE: false,
  MARKS_PUBLISHED: true,
  LOW_MARKS: true,
  EXAM_SCHEDULE: true,
  BROADCAST: true,
  LEAVE_RECORDED: false,
  ELIGIBILITY_WARNING: true,
  LOGIN_OTP: true,
};

/** Triggers the admin can switch on/off in Settings (the rest are always on or not built yet). */
export const CONFIGURABLE_TRIGGERS = [
  "WEEKLY_SUMMARY",
  "ATTENDANCE_WARNING",
  "ATTENDANCE_SHORTAGE",
  "CONSECUTIVE_ABSENCE",
  "DAY_ABSENCE",
  "LEAVE_RECORDED",
  "MARKS_PUBLISHED",
  "LOW_MARKS",
] as const satisfies readonly Trigger[];

export const TRIGGER_LABEL: Record<Trigger, string> = {
  WEEKLY_SUMMARY: "Weekly attendance summary",
  ATTENDANCE_WARNING: "Attendance fell below the warning level",
  ATTENDANCE_SHORTAGE: "Attendance fell below the minimum",
  CONSECUTIVE_ABSENCE: "Absent several days in a row",
  DAY_ABSENCE: "Absent for a whole day",
  MARKS_PUBLISHED: "Marks published",
  LOW_MARKS: "Low marks",
  EXAM_SCHEDULE: "Exam schedule",
  BROADCAST: "College notice",
  LEAVE_RECORDED: "Leave / OD recorded",
  ELIGIBILITY_WARNING: "Exam eligibility warning",
  LOGIN_OTP: "Parent login code",
};

/**
 * Messages that still go to parents who opted out of "updates", and that fall back to SMS when
 * WhatsApp fails. Everything else is informational.
 */
export const CRITICAL: ReadonlySet<Trigger> = new Set<Trigger>(["ATTENDANCE_SHORTAGE", "CONSECUTIVE_ABSENCE", "ELIGIBILITY_WARNING", "LOGIN_OTP"]);

export interface ContactFact {
  id: number;
  phone: string;
  language: "EN" | "KN" | "BOTH";
  whatsappOk: boolean;
  consentAt: Date | string | null;
  optedOutAt: Date | string | null;
}

export type Skip = "NO_CONSENT" | "OPTED_OUT";

/** Who gets a message, and on which channel. DPDP Act: no consent, no message — even critical ones. */
export function chooseRecipients<C extends ContactFact>(contacts: readonly C[], trigger: Trigger): { contact: C; channel: Channel }[] {
  const out: { contact: C; channel: Channel }[] = [];
  const seen = new Set<string>();
  for (const c of contacts) {
    if (seen.has(c.phone)) continue; // the same number saved twice (e.g. as father and guardian) gets one message
    if (skipReason(c, trigger)) continue;
    seen.add(c.phone);
    out.push({ contact: c, channel: c.whatsappOk ? "WHATSAPP" : "SMS" });
  }
  return out;
}

export function skipReason(c: ContactFact, trigger: Trigger): Skip | null {
  if (!c.consentAt) return "NO_CONSENT";
  if (c.optedOutAt && !CRITICAL.has(trigger)) return "OPTED_OUT";
  return null;
}

/** Quiet hours in college time: nothing is sent from 21:00 to 08:00 (docs/PLAN.md §8.3). */
export const QUIET_START_HOUR = 21;
export const QUIET_END_HOUR = 8;
const IST_OFFSET_MIN = 330;

/** Hour (0–23) and date in India for an instant. */
export function istParts(at: Date): { date: IsoDate; hour: number; minute: number } {
  const ist = new Date(at.getTime() + IST_OFFSET_MIN * 60_000);
  return { date: ist.toISOString().slice(0, 10), hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
}

/** The instant for a wall-clock time in India. */
export function istInstant(date: IsoDate, hour: number, minute = 0): Date {
  return new Date(Date.parse(`${date}T00:00:00Z`) + ((hour * 60 + minute) - IST_OFFSET_MIN) * 60_000);
}

/** Earliest allowed send time at or after `at`: inside quiet hours it moves to 08:00 IST. OTPs are never delayed. */
export function sendableAt(at: Date, trigger: Trigger): Date {
  if (trigger === "LOGIN_OTP") return at;
  const { date, hour } = istParts(at);
  if (hour >= QUIET_START_HOUR) return istInstant(addDays(date, 1), QUIET_END_HOUR);
  if (hour < QUIET_END_HOUR) return istInstant(date, QUIET_END_HOUR);
  return at;
}

export const MAX_ATTEMPTS = 5;

/** Wait before retry n (1-based): 1, 4, 16, 64 minutes. */
export function retryDelayMinutes(attempt: number): number {
  return 4 ** Math.max(0, attempt - 1);
}

const RANK: Record<Standing, number> = { NO_DATA: 0, OK: 1, AT_RISK: 2, SHORTAGE: 3 };

/**
 * Decide the attendance alert for a student given the standing their parents were last told about.
 * - worse than before → alert (ATTENDANCE_WARNING / ATTENDANCE_SHORTAGE) and remember the new standing;
 * - better than before → no message, but remember it, so a later drop alerts again;
 * - same → nothing.
 */
export function attendanceAlert(previous: Standing | null, now: Standing): { trigger: "ATTENDANCE_WARNING" | "ATTENDANCE_SHORTAGE" | null; remember: Standing | null } {
  if (now === "NO_DATA") return { trigger: null, remember: null };
  const prev = previous ?? "OK";
  if (RANK[now] > RANK[prev]) return { trigger: now === "SHORTAGE" ? "ATTENDANCE_SHORTAGE" : "ATTENDANCE_WARNING", remember: now };
  if (RANK[now] < RANK[prev]) return { trigger: null, remember: now };
  return { trigger: null, remember: previous === null ? now : null };
}

export interface DayFact {
  date: IsoDate;
  /** Classes that day that count for the student and are entered. */
  marked: number;
  /** Of those, how many the student attended or was covered for (present / late / any leave or OD). */
  attended: number;
  /** Classes that day not entered yet. */
  unmarked: number;
}

/** A whole day absent: every class entered, at least one, none attended or covered by leave. */
export function isAbsentDay(d: DayFact): boolean {
  return d.marked > 0 && d.unmarked === 0 && d.attended === 0;
}

/**
 * Current run of whole days absent, ending on the latest day that says anything.
 * - a day with any class attended (or covered by leave) ends the run;
 * - days with nothing entered (holidays, Sundays) or only partly entered neither break nor extend it,
 *   so an unentered class can never make a student look absent.
 */
export function absenceStreak(days: readonly DayFact[]): { from: IsoDate; to: IsoDate; days: number } | null {
  const sorted = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let n = 0;
  let from: IsoDate | null = null;
  let to: IsoDate | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const d = sorted[i];
    if (d.attended > 0) break;
    if (!isAbsentDay(d)) continue;
    n++;
    from = d.date;
    to ??= d.date;
  }
  return n === 0 ? null : { from: from!, to: to!, days: n };
}

/** The weekly summary goes out from Sunday 17:00 IST and covers Monday–Saturday. */
export const WEEKLY_SEND_HOUR = 17;
/** A run that missed Sunday evening still sends up to this many hours later (then the week is skipped, not sent stale). */
export const WEEKLY_CATCH_UP_HOURS = 40;

/** The Mon–Sat week whose summary is due at `now`, or null outside the sending window. */
export function weeklyWindow(now: Date): { from: IsoDate; to: IsoDate } | null {
  const { date } = istParts(now);
  const sunday = addDays(date, 7 - isoWeekdayOf(date)); // this week's Sunday (today if Sunday)
  for (const sun of [sunday, addDays(sunday, -7)]) {
    const due = istInstant(sun, WEEKLY_SEND_HOUR).getTime();
    if (now.getTime() >= due && now.getTime() < due + WEEKLY_CATCH_UP_HOURS * 3_600_000) return { from: addDays(sun, -6), to: addDays(sun, -1) };
  }
  return null;
}

function isoWeekdayOf(date: IsoDate): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Dedupe keys: one message per (thing, contact), whatever the number of runs. */
export const dedupeKey = {
  weekly: (studentId: number, weekStart: IsoDate, contactId: number) => `WEEKLY:${studentId}:${weekStart}:${contactId}`,
  standing: (trigger: Trigger, studentId: number, termId: number, on: IsoDate, contactId: number) => `${trigger}:${studentId}:${termId}:${on}:${contactId}`,
  streak: (studentId: number, from: IsoDate, contactId: number) => `CONSECUTIVE:${studentId}:${from}:${contactId}`,
  day: (studentId: number, date: IsoDate, contactId: number) => `DAY:${studentId}:${date}:${contactId}`,
  leave: (leaveId: number, contactId: number) => `LEAVE:${leaveId}:${contactId}`,
  broadcast: (broadcastId: string, contactId: number) => `BROADCAST:${broadcastId}:${contactId}`,
  /** One marks message per test per student per number: reopening and re-publishing does not resend. */
  marks: (assessmentId: number, studentId: number, contactId: number) => `MARKS:${assessmentId}:${studentId}:${contactId}`,
  loginCode: (otpId: number) => `OTP:${otpId}`,
  smsFallback: (original: string) => `${original}:SMS`,
};

/** A subject needs at least this many counted classes before it can raise an alert (one absence in week 1 is not "below 60%"). */
export const MIN_CLASSES_FOR_ALERT = 8;

/** Standing used for alerts: the worst subject among subjects with enough classes. */
export function alertStanding(subjects: readonly { standing: Standing; counted: number }[], minClasses = MIN_CLASSES_FOR_ALERT): Standing {
  let worst: Standing = "NO_DATA";
  for (const s of subjects) if (s.counted >= minClasses && RANK[s.standing] > RANK[worst]) worst = s.standing;
  return worst;
}
