/**
 * Rules for taking attendance. Pure functions — see marking.test.ts.
 */
import { addDays, type IsoDate } from "./dates";

export type LockState = "FUTURE" | "OPEN" | "LOCKED";

/**
 * FUTURE: the day hasn't come yet — can't be marked.
 * OPEN: teachers may mark/edit (today and the next `lockDays` days after the class).
 * LOCKED: changes need an approved edit request (HOD/admin can still edit directly).
 */
export function lockState(sessionDate: IsoDate, today: IsoDate, lockDays: number): LockState {
  if (sessionDate > today) return "FUTURE";
  return addDays(sessionDate, lockDays) >= today ? "OPEN" : "LOCKED";
}

/** Last day a teacher can still edit without approval. */
export function editableUntil(sessionDate: IsoDate, lockDays: number): IsoDate {
  return addDays(sessionDate, lockDays);
}

export interface RosterEntry {
  studentId: number;
  regNo: string;
}

/** "204CS25012" → 12. */
export const rollOf = (regNo: string) => Number(regNo.slice(-3));
/** "204CS25012" → "25012" (admission year + roll), used when two students share a roll in one class. */
export const longRollOf = (regNo: string) => regNo.slice(-5);

/**
 * Short label to show/type for each student. Normally the 3-digit roll ("12"); if two students
 * in the roster share a roll (e.g. a detained student from an older batch) both get year+roll ("25058").
 */
export function rollLabels(roster: readonly RosterEntry[]): Map<number, string> {
  const counts = new Map<number, number>();
  for (const r of roster) counts.set(rollOf(r.regNo), (counts.get(rollOf(r.regNo)) ?? 0) + 1);
  return new Map(roster.map((r) => [r.studentId, counts.get(rollOf(r.regNo))! > 1 ? longRollOf(r.regNo) : String(rollOf(r.regNo))]));
}

export interface RollParseResult {
  studentIds: number[];
  /** Tokens that matched nobody. */
  unknown: string[];
  /** Tokens that match more than one student (type the 5-digit form). */
  ambiguous: string[];
}

/**
 * Parse what a teacher types from the attendance book: "3, 12 27", "5-8", "25058".
 * Accepts commas/spaces/newlines, ranges, 3-digit rolls or 5-digit year+roll.
 */
export function parseRolls(input: string, roster: readonly RosterEntry[]): RollParseResult {
  const byRoll = new Map<number, number[]>();
  const byLong = new Map<string, number>();
  for (const r of roster) {
    byRoll.set(rollOf(r.regNo), [...(byRoll.get(rollOf(r.regNo)) ?? []), r.studentId]);
    byLong.set(longRollOf(r.regNo), r.studentId);
  }
  const ids = new Set<number>();
  const unknown: string[] = [];
  const ambiguous: string[] = [];
  const addRoll = (token: string, roll: number) => {
    const hits = byRoll.get(roll) ?? [];
    if (hits.length === 1) ids.add(hits[0]);
    else if (hits.length > 1) ambiguous.push(token);
    else unknown.push(token);
  };

  for (const token of input.split(/[\s,;]+/).filter(Boolean)) {
    const range = /^(\d{1,3})-(\d{1,3})$/.exec(token);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      if (a > b || b - a > 200) {
        unknown.push(token);
        continue;
      }
      for (let n = a; n <= b; n++) if (byRoll.has(n)) addRoll(String(n), n);
      continue;
    }
    if (/^\d{5}$/.test(token)) {
      const hit = byLong.get(token);
      if (hit !== undefined) ids.add(hit);
      else unknown.push(token);
      continue;
    }
    if (/^\d{1,3}$/.test(token)) {
      addRoll(token, Number(token));
      continue;
    }
    unknown.push(token);
  }
  return { studentIds: [...ids], unknown, ambiguous };
}

export type Mark = "PRESENT" | "ABSENT" | "LATE";

/** Students whose mark differs between two versions — for the audit log and edit requests. */
export function diffMarks(before: ReadonlyMap<number, Mark>, after: ReadonlyMap<number, Mark>) {
  const changes: { studentId: number; from: Mark | null; to: Mark }[] = [];
  for (const [studentId, to] of after) {
    const from = before.get(studentId) ?? null;
    if (from !== to) changes.push({ studentId, from, to });
  }
  return changes;
}
