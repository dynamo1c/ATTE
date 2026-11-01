import { describe, expect, it } from "vitest";
import { monthRange, monthsBetween, REGISTER_CODE } from "./register";

describe("register", () => {
  it("month ranges, including February in a leap year", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-13")).toBeNull();
    expect(monthRange("2026-1")).toBeNull();
    expect(monthRange(undefined)).toBeNull();
  });

  it("lists term months newest first, across a year end", () => {
    expect(monthsBetween("2026-08-17", "2026-11-01")).toEqual(["2026-11", "2026-10", "2026-09", "2026-08"]);
    expect(monthsBetween("2026-12-10", "2027-01-05")).toEqual(["2027-01", "2026-12"]);
    expect(monthsBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });

  it("a class that isn't the student's is blank, an unentered one is ?", () => {
    expect(REGISTER_CODE.NOT_APPLICABLE).toBe("");
    expect(REGISTER_CODE.UNMARKED).toBe("?");
  });
});
