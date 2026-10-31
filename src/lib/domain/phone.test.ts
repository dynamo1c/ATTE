import { describe, expect, it } from "vitest";
import { formatIndianMobile, normalizeIndianMobile } from "./phone";

describe("normalizeIndianMobile", () => {
  it.each([
    ["9845012345", "+919845012345"],
    ["98450 12345", "+919845012345"],
    ["+91-98450-12345", "+919845012345"],
    ["+91 98450 12345", "+919845012345"],
    ["919845012345", "+919845012345"],
    ["09845012345", "+919845012345"],
    ["(984) 501-2345", "+919845012345"],
    ["6000000001", "+916000000001"],
  ])("normalizes %j", (input, expected) => {
    expect(normalizeIndianMobile(input)).toEqual({ ok: true, value: expected });
  });

  it.each(["5845012345", "984501234", "98450123456", "+1 9845012345", "98450abcde", ""])("rejects %j", (input) => {
    expect(normalizeIndianMobile(input).ok).toBe(false);
  });

  it("formats for display", () => {
    expect(formatIndianMobile("+919845012345")).toBe("98450 12345");
  });
});
