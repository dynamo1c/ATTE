import { describe, expect, it } from "vitest";
import { diffMarks, lockState, parseRolls, rollLabels, type Mark } from "./marking";

const roster = [
  { studentId: 1, regNo: "204CS26001" },
  { studentId: 2, regNo: "204CS26002" },
  { studentId: 3, regNo: "204CS26003" },
  { studentId: 12, regNo: "204CS26012" },
  { studentId: 58, regNo: "204CS26058" },
  { studentId: 99, regNo: "204CS25058" }, // detained student, same roll 58
];

describe("lockState", () => {
  it("cannot mark future classes", () => {
    expect(lockState("2026-11-02", "2026-11-01", 3)).toBe("FUTURE");
  });
  it("is open today and for lockDays after", () => {
    expect(lockState("2026-11-01", "2026-11-01", 3)).toBe("OPEN");
    expect(lockState("2026-10-29", "2026-11-01", 3)).toBe("OPEN");
    expect(lockState("2026-10-28", "2026-11-01", 3)).toBe("LOCKED");
  });
  it("lockDays 0 means same day only", () => {
    expect(lockState("2026-11-01", "2026-11-01", 0)).toBe("OPEN");
    expect(lockState("2026-10-31", "2026-11-01", 0)).toBe("LOCKED");
  });
});

describe("rollLabels", () => {
  it("uses 3-digit rolls, and year+roll only where rolls collide", () => {
    const l = rollLabels(roster);
    expect(l.get(1)).toBe("1");
    expect(l.get(12)).toBe("12");
    expect(l.get(58)).toBe("26058");
    expect(l.get(99)).toBe("25058");
  });
});

describe("parseRolls", () => {
  it("accepts commas, spaces, newlines and leading zeros", () => {
    expect(parseRolls("1, 003\n12", roster).studentIds.sort((a, b) => a - b)).toEqual([1, 3, 12]);
  });
  it("expands ranges, skipping rolls not in the class", () => {
    expect(parseRolls("1-3", roster).studentIds.sort()).toEqual([1, 2, 3]);
    expect(parseRolls("10-12", roster)).toEqual({ studentIds: [12], unknown: [], ambiguous: [] });
  });
  it("reports unknown and ambiguous tokens instead of guessing", () => {
    const r = parseRolls("7 58 abc", roster);
    expect(r.studentIds).toEqual([]);
    expect(r.unknown).toEqual(["7", "abc"]);
    expect(r.ambiguous).toEqual(["58"]);
  });
  it("resolves shared rolls with the 5-digit form", () => {
    expect(parseRolls("25058", roster).studentIds).toEqual([99]);
    expect(parseRolls("26058", roster).studentIds).toEqual([58]);
  });
  it("rejects reversed or absurd ranges", () => {
    expect(parseRolls("9-3", roster).unknown).toEqual(["9-3"]);
  });
  it("empty input is fine", () => {
    expect(parseRolls("  ", roster)).toEqual({ studentIds: [], unknown: [], ambiguous: [] });
  });
});

describe("diffMarks", () => {
  it("lists only changed or new marks", () => {
    const before = new Map<number, Mark>([
      [1, "PRESENT"],
      [2, "ABSENT"],
    ]);
    const after = new Map<number, Mark>([
      [1, "PRESENT"],
      [2, "LATE"],
      [3, "ABSENT"],
    ]);
    expect(diffMarks(before, after)).toEqual([
      { studentId: 2, from: "ABSENT", to: "LATE" },
      { studentId: 3, from: null, to: "ABSENT" },
    ]);
  });
});
