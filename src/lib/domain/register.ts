/**
 * Monthly attendance register (the familiar book layout): one row per student, one column per class.
 */
import type { Outcome } from "./attendance";
import type { IsoDate } from "./dates";

/** One letter (or two) per class, as written in the register book. Blank = the class isn't for this student. */
export const REGISTER_CODE: Record<Outcome, string> = {
  PRESENT: "P",
  LATE: "L",
  ABSENT: "A",
  LEAVE_PRESENT: "P*",
  LEAVE_EXCUSED: "E",
  LEAVE_ABSENT: "A*",
  UNMARKED: "?",
  NOT_APPLICABLE: "",
};

export const REGISTER_LEGEND = "P present · L late (counts as present) · A absent · P* on leave/OD counted as present · E leave not counted · A* on leave, counted absent · ? not yet entered · blank: not this student's class (other batch, not yet joined or left)";

/** "2026-10" → first and last day; null if not a real month. */
export function monthRange(month: unknown): { from: IsoDate; to: IsoDate } | null {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** Months from the term start to `until` (inclusive), newest first: ["2026-11", "2026-10", …]. */
export function monthsBetween(from: IsoDate, until: IsoDate): string[] {
  const out: string[] = [];
  if (from > until) return out;
  let [y, m] = from.slice(0, 7).split("-").map(Number);
  const end = until.slice(0, 7);
  for (let i = 0; i < 36; i++) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    if (key > end) break;
    out.push(key);
    if (m === 12) {
      m = 1;
      y++;
    } else m++;
  }
  return out.reverse();
}
