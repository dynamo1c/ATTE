import { describe, expect, it } from "vitest";
import { cleanCode, cleanRegNo, codeHash, maskPhone, newCode, requestBlock, sameHash } from "./otp";

const now = new Date("2026-11-01T10:00:00Z");
const none = { phoneInWindow: 0, phoneInDay: 0, ipInWindow: 0, lastForPhone: null };

describe("login codes", () => {
  it("are 6 digits, leading zeros kept", () => {
    for (let i = 0; i < 200; i++) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it("hash depends on the challenge", () => {
    expect(codeHash("a", "123456")).not.toBe(codeHash("b", "123456"));
    expect(sameHash(codeHash("a", "123456"), codeHash("a", "123456"))).toBe(true);
    expect(sameHash(codeHash("a", "123456"), codeHash("a", "123457"))).toBe(false);
    expect(sameHash("", "")).toBe(false);
  });

  it("accepts typed codes with spaces only", () => {
    expect(cleanCode(" 123 456 ")).toBe("123456");
    expect(cleanCode("12345")).toBeNull();
    expect(cleanCode("12345a")).toBeNull();
    expect(cleanCode(undefined)).toBeNull();
  });
});

describe("requestBlock", () => {
  it("allows a first request", () => expect(requestBlock(none, now)).toBeNull());

  it("makes the parent wait between codes", () => {
    const r = requestBlock({ ...none, lastForPhone: new Date(now.getTime() - 20_000) }, now);
    expect(r?.error).toContain("40 seconds");
    expect(requestBlock({ ...none, lastForPhone: new Date(now.getTime() - 61_000) }, now)).toBeNull();
  });

  it("limits per phone and per IP", () => {
    expect(requestBlock({ ...none, phoneInWindow: 3 }, now)).not.toBeNull();
    expect(requestBlock({ ...none, phoneInDay: 10 }, now)?.error).toContain("tomorrow");
    expect(requestBlock({ ...none, ipInWindow: 20 }, now)).not.toBeNull();
    expect(requestBlock({ ...none, phoneInWindow: 2, ipInWindow: 19 }, now)).toBeNull();
  });
});

describe("display helpers", () => {
  it("masks the phone", () => expect(maskPhone("+919845012345")).toBe("98••• •••45"));
  it("normalises register numbers", () => {
    expect(cleanRegNo(" 204cs 25012 ")).toBe("204CS25012");
    expect(cleanRegNo("204CS2501")).toBeNull();
  });
});
