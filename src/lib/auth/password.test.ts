import { describe, expect, it } from "vitest";
import { generateTempPassword, hashPassword, passwordProblem, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects wrong ones", async () => {
    const hash = await hashPassword("college2026");
    expect(hash.startsWith("scrypt$16384$8$1$")).toBe(true);
    expect(await verifyPassword("college2026", hash)).toBe(true);
    expect(await verifyPassword("college2027", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same-pass1")).not.toBe(await hashPassword("same-pass1"));
  });

  it("rejects garbage stored values without throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });
});

describe("password rules", () => {
  it.each([
    ["short1", "at least 8"],
    ["onlyletters", "letters and numbers"],
    ["12345678", "letters and numbers"],
  ])("rejects %j", (pw, msg) => {
    expect(passwordProblem(pw)).toContain(msg);
  });

  it("accepts a reasonable password", () => {
    expect(passwordProblem("mei2026pass")).toBeNull();
  });

  it("generates temp passwords that pass the rules", () => {
    for (let i = 0; i < 20; i++) {
      const p = generateTempPassword();
      expect(p).toMatch(/^[a-z]{6}[2-9]{4}$/);
      expect(passwordProblem(p)).toBeNull();
    }
  });
});
