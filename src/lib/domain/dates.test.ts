import { describe, expect, it } from "vitest";
import { addDays, assertIsoDate, dateRange, isoWeekday, todayIn, weekStart } from "./dates";

describe("dates", () => {
  it("knows weekdays (2026-10-31 is a Saturday)", () => {
    expect(isoWeekday("2026-10-31")).toBe(6);
    expect(isoWeekday("2026-11-01")).toBe(7);
    expect(isoWeekday("2026-11-02")).toBe(1);
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("builds inclusive ranges", () => {
    expect(dateRange("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(dateRange("2026-11-02", "2026-11-01")).toEqual([]);
  });

  it("finds the Monday of a week", () => {
    expect(weekStart("2026-10-31")).toBe("2026-10-26");
    expect(weekStart("2026-10-26")).toBe("2026-10-26");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });

  it("rejects impossible dates", () => {
    expect(() => assertIsoDate("2026-02-30")).toThrow();
    expect(() => assertIsoDate("31-10-2026")).toThrow();
  });

  it("computes today in IST, not UTC", () => {
    // 2026-10-31 20:00 UTC is already 1 Nov 01:30 in India.
    expect(todayIn("Asia/Kolkata", new Date("2026-10-31T20:00:00Z"))).toBe("2026-11-01");
  });
});
