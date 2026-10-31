import { isoWeekday, type IsoDate } from "./dates";

export type DayType = "WORKING" | "HOLIDAY" | "EXAM" | "EVENT";

export interface CalendarEntry {
  date: IsoDate;
  type: DayType;
  followsWeekday: number | null;
  departmentId: number | null;
  classGroupId: number | null;
  note: string | null;
}

export interface ResolvedDay {
  date: IsoDate;
  type: DayType;
  /** Whether timetable classes run. EXAM and HOLIDAY days have no regular classes. */
  classesRun: boolean;
  /** Which weekday's timetable to follow (handles "Saturday follows Monday"). Null when no classes. */
  timetableWeekday: number | null;
  source: "DEFAULT" | "COLLEGE" | "DEPARTMENT" | "CLASS";
  note: string | null;
}

const RUNS_CLASSES: Record<DayType, boolean> = { WORKING: true, EVENT: true, HOLIDAY: false, EXAM: false };

/**
 * Resolve one date for one class. Most specific override wins: class > department > college > default.
 * Default: Monday–Saturday working, Sunday holiday.
 */
export function resolveDay(
  date: IsoDate,
  entries: readonly CalendarEntry[],
  scope: { departmentId: number; classGroupId: number },
): ResolvedDay {
  const sameDay = entries.filter((e) => e.date === date);
  const pick =
    sameDay.find((e) => e.classGroupId === scope.classGroupId) ??
    sameDay.find((e) => e.departmentId === scope.departmentId && e.classGroupId === null) ??
    sameDay.find((e) => e.departmentId === null && e.classGroupId === null);

  if (!pick) {
    const weekday = isoWeekday(date);
    const working = weekday !== 7;
    return {
      date,
      type: working ? "WORKING" : "HOLIDAY",
      classesRun: working,
      timetableWeekday: working ? weekday : null,
      source: "DEFAULT",
      note: null,
    };
  }

  const classesRun = RUNS_CLASSES[pick.type];
  return {
    date,
    type: pick.type,
    classesRun,
    timetableWeekday: classesRun ? (pick.followsWeekday ?? isoWeekday(date)) : null,
    source: pick.classGroupId !== null ? "CLASS" : pick.departmentId !== null ? "DEPARTMENT" : "COLLEGE",
    note: pick.note,
  };
}
