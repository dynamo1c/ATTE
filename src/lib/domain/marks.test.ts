import { describe, expect, it } from "vitest";
import { computeSubjectResult, formatEntry, formatMark, isLowMark, parseFormula, parseMarkInput, type MarkEntry, type SchemePart } from "./marks";

const main: SchemePart[] = [
  { code: "CIE_T1", label: "Theory test 1", isFinal: false, maxMarks: 50 },
  { code: "CIE_T2", label: "Theory test 2", isFinal: false, maxMarks: 50 },
  { code: "CIE_P1", label: "Practical test 1", isFinal: false, maxMarks: 50 },
  { code: "CIE_P2", label: "Practical test 2", isFinal: false, maxMarks: 50 },
  { code: "ACT", label: "Activity", isFinal: false, maxMarks: 50 },
  { code: "SEE", label: "Final exam", isFinal: true, maxMarks: 100 },
];
const minor: SchemePart[] = [1, 2, 3, 4].map((n) => ({ code: `CIE_T${n}`, label: `Theory test ${n}`, isFinal: false, maxMarks: 50 })).concat([{ code: "ACT", label: "Activity", isFinal: false, maxMarks: 50 }]);

const v = (value: number): MarkEntry => ({ value, flag: null });
const marks = (o: Record<string, MarkEntry>) => new Map(Object.entries(o));

describe("computeSubjectResult", () => {
  it("matches the lecturer's example: 210/250 → 42, 75/100 → 37.5, total 79.5", () => {
    const r = computeSubjectResult(main, marks({ CIE_T1: v(42), CIE_T2: v(40), CIE_P1: v(45), CIE_P2: v(43), ACT: v(40), SEE: v(75) }), { cieOutOf: 50, seeOutOf: 50 });
    expect(r.cie.obtained).toBe(210);
    expect(r.cie.scaled).toBe(42);
    expect(r.see?.scaled).toBe(37.5);
    expect(r.total).toBe(79.5);
    expect(r.outOf).toBe(100);
    expect(r.complete).toBe(true);
  });

  it("keeps decimals: 211/250 → 42.2", () => {
    const r = computeSubjectResult(main.filter((p) => !p.isFinal), marks({ CIE_T1: v(43), CIE_T2: v(40), CIE_P1: v(45), CIE_P2: v(43), ACT: v(40) }), { cieOutOf: 50, seeOutOf: null });
    expect(r.cie.scaled).toBe(42.2);
  });

  it("AB and MP count as zero", () => {
    const r = computeSubjectResult(main, marks({ CIE_T1: { value: null, flag: "AB" }, CIE_T2: v(50), CIE_P1: v(50), CIE_P2: { value: null, flag: "MP" }, ACT: v(50), SEE: v(100) }), { cieOutOf: 50, seeOutOf: 50 });
    expect(r.cie.obtained).toBe(150);
    expect(r.cie.scaled).toBe(30);
    expect(r.total).toBe(80);
  });

  it("a part not entered is not zero: result incomplete, so-far figure from entered parts", () => {
    const r = computeSubjectResult(main, marks({ CIE_T1: v(40), CIE_P1: v(30) }), { cieOutOf: 50, seeOutOf: 50 });
    expect(r.complete).toBe(false);
    expect(r.total).toBeNull();
    expect(r.cie.scaled).toBeNull();
    expect(r.cie.scaledSoFar).toBe(35); // 70/100 × 50
    expect(r.missing).toEqual(["CIE_T2", "CIE_P2", "ACT", "SEE"]);
  });

  it("minor subject: no final, result out of 50", () => {
    const r = computeSubjectResult(minor, marks({ CIE_T1: v(40), CIE_T2: v(40), CIE_T3: v(40), CIE_T4: v(40), ACT: v(50) }), { cieOutOf: 50, seeOutOf: null });
    expect(r.see).toBeNull();
    expect(r.outOf).toBe(50);
    expect(r.total).toBe(42);
    expect(r.complete).toBe(true);
  });

  it("minor scaled to 100 if the college says so (data change only)", () => {
    const r = computeSubjectResult(minor, marks({ CIE_T1: v(40), CIE_T2: v(40), CIE_T3: v(40), CIE_T4: v(40), ACT: v(50) }), { cieOutOf: 100, seeOutOf: null });
    expect(r.total).toBe(84);
    expect(r.outOf).toBe(100);
  });

  it("sums half marks exactly", () => {
    const r = computeSubjectResult(main.filter((p) => !p.isFinal), marks({ CIE_T1: v(10.1), CIE_T2: v(10.2), CIE_P1: v(10.3), CIE_P2: v(0.1), ACT: v(0.2) }), { cieOutOf: 50, seeOutOf: null });
    expect(r.cie.obtained).toBe(30.9);
  });
});

describe("formatMark", () => {
  it("keeps up to 2 decimals and never rounds up", () => {
    expect(formatMark(42)).toBe("42");
    expect(formatMark(42.2)).toBe("42.2");
    expect(formatMark(37.5)).toBe("37.5");
    expect(formatMark(200 / 3)).toBe("66.66");
    expect(formatMark(42.199999999)).toBe("42.2");
    expect(formatMark(0)).toBe("0");
    expect(formatMark(null)).toBe("—");
  });
});

describe("parseMarkInput", () => {
  it("accepts numbers, AB and MP within the max", () => {
    expect(parseMarkInput("38", 50)).toEqual({ ok: true, entry: { value: 38, flag: null } });
    expect(parseMarkInput(" 38.5 ", 50)).toEqual({ ok: true, entry: { value: 38.5, flag: null } });
    expect(parseMarkInput("ab", 50)).toEqual({ ok: true, entry: { value: null, flag: "AB" } });
    expect(parseMarkInput("a", 50)).toEqual({ ok: true, entry: { value: null, flag: "AB" } });
    expect(parseMarkInput("MP", 50)).toEqual({ ok: true, entry: { value: null, flag: "MP" } });
    expect(parseMarkInput("", 50)).toEqual({ ok: true, entry: null });
    expect(parseMarkInput("50", 50).ok).toBe(true);
    expect(parseMarkInput("100", 100).ok).toBe(true);
  });

  it("rejects anything else", () => {
    for (const bad of ["51", "-1", "38.555", "3e1", "x", "38,5", "1000"]) expect(parseMarkInput(bad, 50).ok).toBe(false);
  });

  it("round-trips through formatEntry", () => {
    for (const s of ["38", "38.5", "AB", "MP", "0"]) {
      const p = parseMarkInput(s, 50);
      expect(p.ok && formatEntry(p.entry)).toBe(s);
    }
  });
});

describe("isLowMark & parseFormula", () => {
  it("flags marks below the low level; AB counts as 0", () => {
    expect(isLowMark(v(19.5), 50, 40)).toBe(true);
    expect(isLowMark(v(20), 50, 40)).toBe(false);
    expect(isLowMark({ value: null, flag: "AB" }, 50, 40)).toBe(true);
  });

  it("reads stored formulas safely", () => {
    expect(parseFormula(null)).toEqual({ cieOutOf: 50, seeOutOf: 50 });
    expect(parseFormula({ cieOutOf: 50, seeOutOf: null })).toEqual({ cieOutOf: 50, seeOutOf: null });
    expect(parseFormula({ cieOutOf: -1, seeOutOf: "x" })).toEqual({ cieOutOf: 50, seeOutOf: null });
  });
});
