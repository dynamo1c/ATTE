import { describe, expect, it } from "vitest";
import { formatRegNo, parseRegNo } from "./regNo";

describe("parseRegNo", () => {
  it("parses the documented example", () => {
    expect(parseRegNo("204CS25012")).toEqual({
      ok: true,
      value: { collegeCode: "204", departmentCode: "CS", admissionYear: 2025, roll: 12 },
    });
  });

  it("accepts lowercase and spaces", () => {
    const r = parseRegNo(" 204 cs 25 012 ");
    expect(r.ok && formatRegNo(r.value)).toBe("204CS25012");
  });

  it.each(["204CS2501", "204CS250123", "20CS25012", "204C525012", "ABCCS25012", ""])("rejects malformed %j", (input) => {
    expect(parseRegNo(input).ok).toBe(false);
  });

  it("rejects roll 000", () => {
    expect(parseRegNo("204CS25000").ok).toBe(false);
  });

  it("checks college and department when given", () => {
    expect(parseRegNo("205CS25012", { collegeCode: "204" }).ok).toBe(false);
    expect(parseRegNo("204XX25012", { departmentCodes: ["CS", "ME"] }).ok).toBe(false);
    expect(parseRegNo("204ME25012", { collegeCode: "204", departmentCodes: ["CS", "ME"] }).ok).toBe(true);
  });

  it("round-trips", () => {
    for (const s of ["204CE24001", "204CG26060", "204EI25100"]) {
      const r = parseRegNo(s);
      expect(r.ok && formatRegNo(r.value)).toBe(s);
    }
  });
});
