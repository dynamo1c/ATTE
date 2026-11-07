/**
 * Staff leave rules (a teacher's own leave, decided by the HOD / principal). Pure functions with tests.
 * Who decides is in src/lib/auth/permissions.ts (leaveDecidedBy / canDecideStaffLeave).
 */
import { addDays, dateRange, isoWeekday, type IsoDate } from "./dates";

export type StaffLeaveType = "CASUAL" | "MEDICAL" | "EARNED" | "ON_DUTY" | "OTHER";
export type DayPart = "FULL" | "FN" | "AN";
export type StaffLeaveStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";

export const STAFF_LEAVE_TYPE: Record<StaffLeaveType, string> = {
  CASUAL: "Casual leave (CL)",
  MEDICAL: "Medical leave",
  EARNED: "Earned leave (EL)",
  ON_DUTY: "On duty (OD)",
  OTHER: "Other",
};

export const DAY_PART: Record<DayPart, string> = { FULL: "Full day", FN: "Forenoon (morning)", AN: "Afternoon" };

/** Leave can be entered this many days after it was taken (e.g. sudden illness), and this far ahead. */
export const BACKDATE_DAYS = 30;
export const AHEAD_DAYS = 180;
export const MAX_SPAN_DAYS = 60;
/** Forenoon = classes starting before this time (lunch break); afternoon = from it. */
export const AFTERNOON_FROM = "13:00";

/** Problems with a leave application, keyed by form field; empty = fine. */
export function checkStaffLeave(l: { fromDate: IsoDate; toDate: IsoDate; part: DayPart }, today: IsoDate): Record<string, string> {
  const errors: Record<string, string> = {};
  if (l.toDate < l.fromDate) errors.toDate = "The last day can't be before the first day.";
  else if (dateRange(l.fromDate, l.toDate).length > MAX_SPAN_DAYS) errors.toDate = `At most ${MAX_SPAN_DAYS} days in one application.`;
  if (l.part !== "FULL" && l.fromDate !== l.toDate) errors.part = "A half day must be a single date.";
  if (l.fromDate < addDays(today, -BACKDATE_DAYS)) errors.fromDate = `Leave older than ${BACKDATE_DAYS} days can't be entered here. Ask the admin.`;
  if (l.fromDate > addDays(today, AHEAD_DAYS)) errors.fromDate = `Apply at most ${AHEAD_DAYS} days ahead.`;
  return errors;
}

/** Leave days, Sundays not counted; a half day is 0.5. */
export function leaveDayCount(l: { fromDate: IsoDate; toDate: IsoDate; part: DayPart }): number {
  if (l.part !== "FULL") return isoWeekday(l.fromDate) === 7 ? 0 : 0.5;
  return dateRange(l.fromDate, l.toDate).filter((d) => isoWeekday(d) !== 7).length;
}

/** Whether a class at `startsAt` ("09:00") on `date` falls inside the leave. */
export function leaveCoversClass(l: { fromDate: IsoDate; toDate: IsoDate; part: DayPart }, date: IsoDate, startsAt: string): boolean {
  if (date < l.fromDate || date > l.toDate) return false;
  if (l.part === "FN") return startsAt.slice(0, 5) < AFTERNOON_FROM;
  if (l.part === "AN") return startsAt.slice(0, 5) >= AFTERNOON_FROM;
  return true;
}

/** The applicant may cancel while waiting, or an approved leave that hasn't started yet. */
export function canCancelStaffLeave(l: { status: StaffLeaveStatus; fromDate: IsoDate }, today: IsoDate): boolean {
  return l.status === "PENDING" || (l.status === "APPROVED" && l.fromDate > today);
}

export function formatLeaveDates(l: { fromDate: IsoDate; toDate: IsoDate; part: DayPart }, fmt: (d: IsoDate) => string): string {
  if (l.fromDate === l.toDate) return l.part === "FULL" ? fmt(l.fromDate) : `${fmt(l.fromDate)} (${l.part === "FN" ? "forenoon" : "afternoon"})`;
  return `${fmt(l.fromDate)} – ${fmt(l.toDate)}`;
}
