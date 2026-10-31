import { describe, expect, it } from "vitest";
import { resolveDay, type CalendarEntry } from "./calendar";

const scope = { departmentId: 2, classGroupId: 10 };
const entry = (e: Partial<CalendarEntry> & Pick<CalendarEntry, "date" | "type">): CalendarEntry => ({
  followsWeekday: null,
  departmentId: null,
  classGroupId: null,
  note: null,
  ...e,
});

describe("resolveDay", () => {
  it("defaults: Mon–Sat working, Sunday holiday", () => {
    expect(resolveDay("2026-10-31", [], scope)).toMatchObject({ classesRun: true, timetableWeekday: 6, source: "DEFAULT" });
    expect(resolveDay("2026-11-01", [], scope)).toMatchObject({ classesRun: false, type: "HOLIDAY", timetableWeekday: null });
  });

  it("college holiday stops classes", () => {
    const r = resolveDay("2026-10-02", [entry({ date: "2026-10-02", type: "HOLIDAY", note: "Gandhi Jayanti" })], scope);
    expect(r).toMatchObject({ classesRun: false, source: "COLLEGE", note: "Gandhi Jayanti" });
  });

  it("exam days run no regular classes, event days do", () => {
    expect(resolveDay("2026-10-05", [entry({ date: "2026-10-05", type: "EXAM" })], scope).classesRun).toBe(false);
    expect(resolveDay("2026-10-05", [entry({ date: "2026-10-05", type: "EVENT" })], scope).classesRun).toBe(true);
  });

  it("supports 'Saturday follows Monday timetable'", () => {
    const r = resolveDay("2026-10-31", [entry({ date: "2026-10-31", type: "WORKING", followsWeekday: 1 })], scope);
    expect(r.timetableWeekday).toBe(1);
  });

  it("makes a Sunday working when declared", () => {
    const r = resolveDay("2026-11-01", [entry({ date: "2026-11-01", type: "WORKING", followsWeekday: 3 })], scope);
    expect(r).toMatchObject({ classesRun: true, timetableWeekday: 3 });
  });

  it("most specific scope wins: class > department > college", () => {
    const entries = [
      entry({ date: "2026-10-20", type: "HOLIDAY" }),
      entry({ date: "2026-10-20", type: "WORKING", departmentId: 2 }),
    ];
    expect(resolveDay("2026-10-20", entries, scope)).toMatchObject({ classesRun: true, source: "DEPARTMENT" });
    expect(resolveDay("2026-10-20", entries, { departmentId: 3, classGroupId: 11 })).toMatchObject({ classesRun: false, source: "COLLEGE" });

    const withClass = [...entries, entry({ date: "2026-10-20", type: "EVENT", classGroupId: 10, note: "Industrial visit" })];
    expect(resolveDay("2026-10-20", withClass, scope)).toMatchObject({ source: "CLASS", type: "EVENT" });
  });

  it("ignores other departments' and classes' overrides", () => {
    const entries = [
      entry({ date: "2026-10-21", type: "HOLIDAY", departmentId: 5 }),
      entry({ date: "2026-10-21", type: "HOLIDAY", classGroupId: 99 }),
    ];
    expect(resolveDay("2026-10-21", entries, scope)).toMatchObject({ classesRun: true, source: "DEFAULT" });
  });
});
