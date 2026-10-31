import { describe, expect, it } from "vitest";
import { resolveDay } from "./calendar";
import { activeVersion, allowedComponents, findSlotConflicts, isVersionEditable, planSessionsForDay, type SlotDef, type VersionDef } from "./timetable";

const slot = (s: Partial<SlotDef> & Pick<SlotDef, "id" | "weekday" | "startPeriod" | "endPeriod">): SlotDef => ({
  kind: "CLASS",
  offeringId: 1,
  component: "THEORY",
  batchScope: "ALL",
  ...s,
});

const scope = { departmentId: 1, classGroupId: 1 };

describe("activeVersion", () => {
  const versions = [
    { id: 1, effectiveFrom: "2026-08-17" },
    { id: 2, effectiveFrom: "2026-10-01" },
  ];
  it("picks latest version on or before the date", () => {
    expect(activeVersion(versions, "2026-09-30")?.id).toBe(1);
    expect(activeVersion(versions, "2026-10-01")?.id).toBe(2);
    expect(activeVersion(versions, "2026-12-01")?.id).toBe(2);
  });
  it("returns null before the first version", () => {
    expect(activeVersion(versions, "2026-08-16")).toBeNull();
  });
});

describe("planSessionsForDay", () => {
  const v1: VersionDef = {
    id: 1,
    effectiveFrom: "2026-08-17",
    slots: [
      slot({ id: 1, weekday: 1, startPeriod: 1, endPeriod: 2, component: "PRACTICAL", batchScope: "B1", offeringId: 11 }),
      slot({ id: 2, weekday: 1, startPeriod: 1, endPeriod: 2, component: "PRACTICAL", batchScope: "B2", offeringId: 12 }),
      slot({ id: 3, weekday: 1, startPeriod: 7, endPeriod: 7, kind: "ACTIVITY", offeringId: null, component: null }),
      slot({ id: 4, weekday: 2, startPeriod: 1, endPeriod: 1, offeringId: 13 }),
    ],
  };

  it("creates one session per slot for the weekday, skipping activity periods", () => {
    const sessions = planSessionsForDay(resolveDay("2026-10-26", [], scope), [v1]); // Monday
    expect(sessions.map((s) => s.slotId)).toEqual([1, 2]);
    expect(sessions[0]).toMatchObject({ offeringId: 11, batchScope: "B1", startPeriod: 1, endPeriod: 2, date: "2026-10-26" });
  });

  it("creates nothing on holidays or Sundays", () => {
    expect(planSessionsForDay(resolveDay("2026-11-01", [], scope), [v1])).toEqual([]);
    const holiday = resolveDay("2026-10-26", [{ date: "2026-10-26", type: "HOLIDAY", followsWeekday: null, departmentId: null, classGroupId: null, note: null }], scope);
    expect(planSessionsForDay(holiday, [v1])).toEqual([]);
  });

  it("follows another weekday's timetable when the calendar says so", () => {
    const sat = resolveDay("2026-10-31", [{ date: "2026-10-31", type: "WORKING", followsWeekday: 2, departmentId: null, classGroupId: null, note: null }], scope);
    expect(planSessionsForDay(sat, [v1]).map((s) => s.slotId)).toEqual([4]);
  });

  it("uses the version in force on that date", () => {
    const v2: VersionDef = { id: 2, effectiveFrom: "2026-10-27", slots: [slot({ id: 9, weekday: 2, startPeriod: 3, endPeriod: 3 })] };
    expect(planSessionsForDay(resolveDay("2026-10-20", [], scope), [v1, v2]).map((s) => s.slotId)).toEqual([4]);
    expect(planSessionsForDay(resolveDay("2026-10-27", [], scope), [v1, v2]).map((s) => s.slotId)).toEqual([9]);
  });
});

describe("allowedComponents / isVersionEditable", () => {
  it("limits parts by subject kind", () => {
    expect(allowedComponents("THEORY_ONLY")).toEqual(["THEORY"]);
    expect(allowedComponents("PRACTICAL_ONLY")).toEqual(["PRACTICAL"]);
    expect(allowedComponents("INTEGRATED")).toEqual(["THEORY", "PRACTICAL"]);
  });

  it("locks a version once classes are recorded, unless it starts in the future", () => {
    expect(isVersionEditable({ effectiveFrom: "2026-11-02" }, "2026-11-01", 0)).toBe(true);
    expect(isVersionEditable({ effectiveFrom: "2026-08-17" }, "2026-11-01", 0)).toBe(true);
    expect(isVersionEditable({ effectiveFrom: "2026-08-17" }, "2026-11-01", 120)).toBe(false);
  });
});

describe("findSlotConflicts", () => {
  it("allows B1 and B2 in parallel", () => {
    expect(
      findSlotConflicts([
        slot({ id: 1, weekday: 1, startPeriod: 1, endPeriod: 2, batchScope: "B1" }),
        slot({ id: 2, weekday: 1, startPeriod: 1, endPeriod: 2, batchScope: "B2" }),
      ]),
    ).toEqual([]);
  });

  it("flags whole-class slot overlapping a batch slot", () => {
    const c = findSlotConflicts([
      slot({ id: 1, weekday: 1, startPeriod: 1, endPeriod: 2, batchScope: "B1" }),
      slot({ id: 2, weekday: 1, startPeriod: 2, endPeriod: 2, batchScope: "ALL" }),
    ]);
    expect(c).toHaveLength(1);
  });

  it("flags same batch double-booked; ignores different days and adjacent periods", () => {
    expect(
      findSlotConflicts([
        slot({ id: 1, weekday: 1, startPeriod: 1, endPeriod: 2, batchScope: "B1" }),
        slot({ id: 2, weekday: 1, startPeriod: 2, endPeriod: 3, batchScope: "B1" }),
      ]),
    ).toHaveLength(1);
    expect(
      findSlotConflicts([
        slot({ id: 1, weekday: 1, startPeriod: 1, endPeriod: 2 }),
        slot({ id: 2, weekday: 1, startPeriod: 3, endPeriod: 3 }),
        slot({ id: 3, weekday: 2, startPeriod: 1, endPeriod: 2 }),
      ]),
    ).toEqual([]);
  });
});
