/**
 * Timetables for the dummy data.
 *
 * CS Sem 1 and Sem 3 are transcribed from the official "Time Table of Odd sem 1,3,5" (2026-27, INS-FORMAT-2).
 * CS Sem 5 is "Programme Specialization (Cyber Security)" all day — modelled as one morning and one
 * afternoon session per day until the college says how it is taken (PLAN.md §14 Q4).
 * Other departments reuse these patterns with their own subjects (placeholders until real data arrives).
 *
 * Line format: "<DAY> <startPeriod>-<endPeriod> <SUBJECT>:<T|P>:<ALL|B1|B2> [more...]" or "<DAY> <p>-<p> ACT".
 * Subjects are positional keys S1..S5 so the same grid works for every department.
 * Periods: 1=9-10, 2=10-11, 3=11-12, 4=12-1, (lunch), 5=1:30-2:30, 6=2:30-3:30, 7=3:30-4:30.
 */

// CS Sem 1 — S1 MATHS, S2 BDLCO, S3 FEEE, S4 IT SKILLS, S5 EVS
export const SEM1_GRID = `
MON 1-2 S4:P:B1 S3:P:B2
MON 3-3 S4:T:B1 S3:T:B2
MON 4-4 S2:T:B1
MON 5-6 S2:P:B1 S1:P:B2
MON 7-7 ACT
TUE 1-1 S1:T:ALL
TUE 2-2 S4:T:B1 S3:T:B2
TUE 3-3 ACT
TUE 4-4 S2:T:B1
TUE 5-5 S3:T:B1 S4:T:B2
TUE 6-7 S3:P:B1 S4:P:B2
WED 1-2 S1:T:B1 S2:T:B2
WED 3-3 S1:T:ALL
WED 4-4 S2:T:B2
WED 5-5 S4:T:B1 S3:T:B2
WED 6-7 S4:P:B1 S3:P:B2
THU 1-1 S1:T:ALL
THU 2-2 S5:T:ALL
THU 3-3 S2:T:B1
THU 4-4 S3:T:B1 S4:T:B2
THU 5-6 S3:P:B1 S4:P:B2
THU 7-7 ACT
FRI 1-2 S1:P:B1 S2:P:B2
FRI 3-3 S1:T:ALL
FRI 4-4 S2:T:B2
FRI 5-7 S2:P:B1 S1:P:B2
SAT 1-1 S2:T:B1
SAT 2-2 S5:T:ALL
SAT 3-3 S3:T:B1 S4:T:B2
SAT 4-4 S2:T:B2
`;

// CS Sem 3 — S1 DSP, S2 S&NA, S3 DC&T, S4 CN, S5 KANNADA
export const SEM3_GRID = `
MON 1-2 S1:P:B1 S2:P:B2
MON 3-3 S1:T:B1 S2:T:B2
MON 4-4 S3:T:B1 S4:T:B2
MON 5-6 S4:P:B1 S3:P:B2
MON 7-7 ACT
TUE 1-2 S2:P:B1 S1:P:B2
TUE 3-3 S2:T:B1 S1:T:B2
TUE 4-4 S3:T:B1 S4:T:B2
TUE 5-7 ACT
WED 1-2 S3:P:B1 S4:P:B2
WED 3-3 S3:T:B1 S4:T:B2
WED 4-4 S5:T:ALL
WED 5-5 S1:T:B1 S2:T:B2
WED 6-7 S1:P:B1 S2:P:B2
THU 1-1 S1:T:B1 S2:T:B2
THU 2-3 ACT
THU 4-4 S5:T:ALL
THU 5-5 S2:T:B1 S1:T:B2
THU 6-7 S2:P:B1 S1:P:B2
FRI 1-2 S4:P:B1 S3:P:B2
FRI 3-3 S4:T:B1 S3:T:B2
FRI 4-4 ACT
FRI 5-5 S3:T:B1 S4:T:B2
FRI 6-7 S3:P:B1 S4:P:B2
SAT 1-1 S4:T:B1 S3:T:B2
SAT 2-2 S4:T:B1 S3:T:B2
SAT 3-3 S2:T:B1 S1:T:B2
SAT 4-4 ACT
`;

// Sem 5 — S1 Programme Specialization
export const SEM5_GRID = `
MON 1-4 S1:T:ALL
MON 5-7 S1:T:ALL
TUE 1-4 S1:T:ALL
TUE 5-7 S1:T:ALL
WED 1-4 S1:T:ALL
WED 5-7 S1:T:ALL
THU 1-4 S1:T:ALL
THU 5-7 S1:T:ALL
FRI 1-4 S1:T:ALL
FRI 5-7 S1:T:ALL
SAT 1-4 S1:T:ALL
`;

export interface GridSlot {
  weekday: number;
  startPeriod: number;
  endPeriod: number;
  kind: "CLASS" | "ACTIVITY";
  subjectKey: string | null;
  component: "THEORY" | "PRACTICAL" | null;
  batchScope: "ALL" | "B1" | "B2";
}

const DAYS: Record<string, number> = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

export function parseGrid(grid: string): GridSlot[] {
  const out: GridSlot[] = [];
  for (const raw of grid.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [day, range, ...items] = line.split(/\s+/);
    const weekday = DAYS[day];
    const m = /^(\d)-(\d)$/.exec(range);
    if (!weekday || !m || items.length === 0) throw new Error(`Bad timetable line: "${line}"`);
    const startPeriod = Number(m[1]);
    const endPeriod = Number(m[2]);
    if (items[0] === "ACT") {
      out.push({ weekday, startPeriod, endPeriod, kind: "ACTIVITY", subjectKey: null, component: null, batchScope: "ALL" });
      continue;
    }
    for (const item of items) {
      const [subjectKey, comp, scope] = item.split(":");
      if (!/^S[1-5]$/.test(subjectKey) || !["T", "P"].includes(comp) || !["ALL", "B1", "B2"].includes(scope)) {
        throw new Error(`Bad timetable item "${item}" in "${line}"`);
      }
      out.push({
        weekday,
        startPeriod,
        endPeriod,
        kind: "CLASS",
        subjectKey,
        component: comp === "T" ? "THEORY" : "PRACTICAL",
        batchScope: scope as GridSlot["batchScope"],
      });
    }
  }
  return out;
}

export function gridForSemester(semester: number): string {
  if (semester === 1) return SEM1_GRID;
  if (semester === 3) return SEM3_GRID;
  if (semester === 5) return SEM5_GRID;
  throw new Error(`No dummy timetable for semester ${semester}`);
}
