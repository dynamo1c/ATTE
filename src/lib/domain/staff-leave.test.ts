import { describe, expect, it } from "vitest";
import { canCancelStaffLeave, checkStaffLeave, formatLeaveDates, leaveCoversClass, leaveDayCount } from "./staff-leave";

const today = "2026-11-03";

describe("checkStaffLeave", () => {
  it("accepts a normal application", () => {
    expect(checkStaffLeave({ fromDate: "2026-11-05", toDate: "2026-11-06", part: "FULL" }, today)).toEqual({});
  });
  it("refuses dates in the wrong order", () => {
    expect(checkStaffLeave({ fromDate: "2026-11-06", toDate: "2026-11-05", part: "FULL" }, today).toDate).toBeDefined();
  });
  it("allows a half day only for one date", () => {
    expect(checkStaffLeave({ fromDate: "2026-11-05", toDate: "2026-11-05", part: "AN" }, today)).toEqual({});
    expect(checkStaffLeave({ fromDate: "2026-11-05", toDate: "2026-11-06", part: "FN" }, today).part).toBeDefined();
  });
  it("allows sick leave entered afterwards, within 30 days", () => {
    expect(checkStaffLeave({ fromDate: "2026-10-04", toDate: "2026-10-05", part: "FULL" }, today)).toEqual({});
    expect(checkStaffLeave({ fromDate: "2026-10-03", toDate: "2026-10-03", part: "FULL" }, today).fromDate).toBeDefined();
  });
  it("refuses very long or far-ahead applications", () => {
    expect(checkStaffLeave({ fromDate: "2026-11-05", toDate: "2027-01-10", part: "FULL" }, today).toDate).toBeDefined();
    expect(checkStaffLeave({ fromDate: "2027-06-01", toDate: "2027-06-01", part: "FULL" }, today).fromDate).toBeDefined();
  });
});

describe("leaveDayCount", () => {
  it("skips Sundays and counts half days as 0.5", () => {
    // Sat 7 Nov – Mon 9 Nov 2026: Saturday + Monday.
    expect(leaveDayCount({ fromDate: "2026-11-07", toDate: "2026-11-09", part: "FULL" })).toBe(2);
    expect(leaveDayCount({ fromDate: "2026-11-05", toDate: "2026-11-05", part: "FN" })).toBe(0.5);
  });
});

describe("leaveCoversClass", () => {
  const fn = { fromDate: "2026-11-05", toDate: "2026-11-05", part: "FN" as const };
  it("forenoon covers morning classes only", () => {
    expect(leaveCoversClass(fn, "2026-11-05", "09:00:00")).toBe(true);
    expect(leaveCoversClass(fn, "2026-11-05", "13:30:00")).toBe(false);
  });
  it("afternoon covers classes from 1 pm", () => {
    expect(leaveCoversClass({ ...fn, part: "AN" }, "2026-11-05", "13:30")).toBe(true);
    expect(leaveCoversClass({ ...fn, part: "AN" }, "2026-11-05", "12:00")).toBe(false);
  });
  it("full days cover every class in the range and nothing outside", () => {
    const l = { fromDate: "2026-11-05", toDate: "2026-11-06", part: "FULL" as const };
    expect(leaveCoversClass(l, "2026-11-06", "15:30")).toBe(true);
    expect(leaveCoversClass(l, "2026-11-07", "09:00")).toBe(false);
  });
});

describe("canCancelStaffLeave", () => {
  it("while waiting, or approved and not started", () => {
    expect(canCancelStaffLeave({ status: "PENDING", fromDate: "2026-10-01" }, today)).toBe(true);
    expect(canCancelStaffLeave({ status: "APPROVED", fromDate: "2026-11-04" }, today)).toBe(true);
    expect(canCancelStaffLeave({ status: "APPROVED", fromDate: today }, today)).toBe(false);
    expect(canCancelStaffLeave({ status: "REJECTED", fromDate: "2026-12-01" }, today)).toBe(false);
  });
});

describe("formatLeaveDates", () => {
  it("shows half days and ranges", () => {
    const f = (d: string) => d.slice(5);
    expect(formatLeaveDates({ fromDate: "2026-11-05", toDate: "2026-11-05", part: "AN" }, f)).toBe("11-05 (afternoon)");
    expect(formatLeaveDates({ fromDate: "2026-11-05", toDate: "2026-11-07", part: "FULL" }, f)).toBe("11-05 – 11-07");
  });
});
