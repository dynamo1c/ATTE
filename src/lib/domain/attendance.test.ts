import { describe, expect, it } from "vitest";
import {
  batchOn,
  computeStudentAttendance,
  evaluateSession,
  formatPercent,
  percent,
  standing,
  type LeavePolicy,
  type MembershipFact,
  type SessionFact,
} from "./attendance";

const policy: LeavePolicy = { MEDICAL: "ABSENT", ON_DUTY: "PRESENT", PERSONAL: "ABSENT", OTHER: "ABSENT" };

const member: MembershipFact = {
  joinedOn: "2026-08-17",
  leftOn: null,
  batches: [{ batch: "B1", effectiveFrom: "2026-08-17" }],
};

const s = (p: Partial<SessionFact> & Pick<SessionFact, "id">): SessionFact => ({
  offeringId: 1,
  component: "THEORY",
  batchScope: "ALL",
  date: "2026-10-26",
  status: "HELD",
  ...p,
});

describe("batchOn", () => {
  it("follows batch changes over time", () => {
    const batches = [
      { batch: "B1" as const, effectiveFrom: "2026-08-17" },
      { batch: "B2" as const, effectiveFrom: "2026-10-01" },
    ];
    expect(batchOn(batches, "2026-08-16")).toBeNull();
    expect(batchOn(batches, "2026-09-30")).toBe("B1");
    expect(batchOn(batches, "2026-10-01")).toBe("B2");
  });
});

describe("evaluateSession", () => {
  it("skips sessions of the other batch", () => {
    expect(evaluateSession(s({ id: 1, batchScope: "B2" }), member, "ABSENT", [], policy)).toBe("NOT_APPLICABLE");
    expect(evaluateSession(s({ id: 1, batchScope: "B1" }), member, "ABSENT", [], policy)).toBe("ABSENT");
  });

  it("skips not-held and cancelled sessions", () => {
    expect(evaluateSession(s({ id: 1, status: "NOT_HELD" }), member, undefined, [], policy)).toBe("NOT_APPLICABLE");
    expect(evaluateSession(s({ id: 1, status: "CANCELLED" }), member, undefined, [], policy)).toBe("NOT_APPLICABLE");
  });

  it("skips sessions before joining or after leaving", () => {
    const late: MembershipFact = { ...member, joinedOn: "2026-10-27" };
    expect(evaluateSession(s({ id: 1, date: "2026-10-26" }), late, "ABSENT", [], policy)).toBe("NOT_APPLICABLE");
    const left: MembershipFact = { ...member, leftOn: "2026-10-25" };
    expect(evaluateSession(s({ id: 1, date: "2026-10-26" }), left, "ABSENT", [], policy)).toBe("NOT_APPLICABLE");
    expect(evaluateSession(s({ id: 1, date: "2026-10-25" }), left, "ABSENT", [], policy)).toBe("ABSENT");
  });

  it("reports unmarked sessions instead of guessing", () => {
    expect(evaluateSession(s({ id: 1, status: "SCHEDULED" }), member, undefined, [], policy)).toBe("UNMARKED");
    expect(evaluateSession(s({ id: 1 }), member, undefined, [], policy)).toBe("UNMARKED");
  });

  it("late counts as attended", () => {
    expect(evaluateSession(s({ id: 1 }), member, "LATE", [], policy)).toBe("LATE");
  });

  it("applies leave policy only to absences", () => {
    const od = [{ type: "ON_DUTY" as const, fromDate: "2026-10-26", toDate: "2026-10-26" }];
    expect(evaluateSession(s({ id: 1 }), member, "ABSENT", od, policy)).toBe("LEAVE_PRESENT");
    expect(evaluateSession(s({ id: 1 }), member, "PRESENT", od, policy)).toBe("PRESENT");
    const med = [{ type: "MEDICAL" as const, fromDate: "2026-10-20", toDate: "2026-10-30" }];
    expect(evaluateSession(s({ id: 1 }), member, "ABSENT", med, policy)).toBe("LEAVE_ABSENT");
    expect(evaluateSession(s({ id: 1 }), member, "ABSENT", med, { ...policy, MEDICAL: "EXCUSED" })).toBe("LEAVE_EXCUSED");
  });

  it("picks the most favourable of overlapping leaves", () => {
    const both = [
      { type: "MEDICAL" as const, fromDate: "2026-10-26", toDate: "2026-10-26" },
      { type: "ON_DUTY" as const, fromDate: "2026-10-26", toDate: "2026-10-26" },
    ];
    expect(evaluateSession(s({ id: 1 }), member, "ABSENT", both, policy)).toBe("LEAVE_PRESENT");
  });
});

describe("computeStudentAttendance", () => {
  it("counts a 3-hour lab once and splits theory/practical", () => {
    const sessions = [
      s({ id: 1, component: "THEORY" }),
      s({ id: 2, component: "THEORY", date: "2026-10-27" }),
      s({ id: 3, component: "PRACTICAL", batchScope: "B1" }),
      s({ id: 4, component: "PRACTICAL", batchScope: "B2" }), // other batch
      s({ id: 5, offeringId: 2 }),
    ];
    const marks = new Map([
      [1, "PRESENT" as const],
      [2, "ABSENT" as const],
      [3, "LATE" as const],
      [4, "ABSENT" as const],
      [5, "ABSENT" as const],
    ]);
    const r = computeStudentAttendance({ sessions, membership: member, marks, approvedLeaves: [], policy });
    expect(r.byOffering).toHaveLength(2);
    const o1 = r.byOffering[0];
    expect(o1.theory).toMatchObject({ counted: 2, attended: 1 });
    expect(o1.practical).toMatchObject({ counted: 1, attended: 1, late: 1 });
    expect(o1.total).toMatchObject({ counted: 3, attended: 2 });
    expect(r.overall).toMatchObject({ counted: 4, attended: 2 });
    expect(percent(r.overall)).toBe(50);
  });

  it("overall % is from totals, not an average of subject %", () => {
    // Subject A: 1/1 = 100%. Subject B: 1/3 = 33%. Average would be 66.7%; truth is 2/4 = 50%.
    const sessions = [s({ id: 1, offeringId: 1 }), s({ id: 2, offeringId: 2 }), s({ id: 3, offeringId: 2 }), s({ id: 4, offeringId: 2 })];
    const marks = new Map([
      [1, "PRESENT" as const],
      [2, "PRESENT" as const],
      [3, "ABSENT" as const],
      [4, "ABSENT" as const],
    ]);
    const r = computeStudentAttendance({ sessions, membership: member, marks, approvedLeaves: [], policy });
    expect(percent(r.overall)).toBe(50);
  });

  it("excused leave leaves the denominator; unmarked never counts", () => {
    const sessions = [s({ id: 1 }), s({ id: 2, date: "2026-10-27" }), s({ id: 3, date: "2026-10-28", status: "SCHEDULED" })];
    const marks = new Map([
      [1, "PRESENT" as const],
      [2, "ABSENT" as const],
    ]);
    const r = computeStudentAttendance({
      sessions,
      membership: member,
      marks,
      approvedLeaves: [{ type: "MEDICAL", fromDate: "2026-10-27", toDate: "2026-10-27" }],
      policy: { ...policy, MEDICAL: "EXCUSED" },
    });
    expect(r.overall).toMatchObject({ counted: 1, attended: 1, excused: 1, unmarked: 1 });
    expect(percent(r.overall)).toBe(100);
  });

  it("returns null percent with no data", () => {
    const r = computeStudentAttendance({ sessions: [], membership: member, marks: new Map(), approvedLeaves: [], policy });
    expect(percent(r.overall)).toBeNull();
  });
});

describe("standing & formatting", () => {
  it("classifies against thresholds", () => {
    expect(standing(null, 60, 70)).toBe("NO_DATA");
    expect(standing(59.99, 60, 70)).toBe("SHORTAGE");
    expect(standing(60, 60, 70)).toBe("AT_RISK");
    expect(standing(69.99, 60, 70)).toBe("AT_RISK");
    expect(standing(70, 60, 70)).toBe("OK");
  });

  it("never rounds a shortage up to the threshold", () => {
    expect(formatPercent(59.96)).toBe("59.9%");
    expect(formatPercent(60)).toBe("60.0%");
    expect(formatPercent((2 / 3) * 100)).toBe("66.6%");
    expect(formatPercent(100)).toBe("100.0%");
    expect(formatPercent(null)).toBe("—");
  });
});
