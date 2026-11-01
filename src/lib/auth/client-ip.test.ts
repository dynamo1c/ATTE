import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("clientIp", () => {
  it("takes the address our proxy saw, not what the visitor typed", () => {
    expect(clientIp("6.6.6.6, 203.0.113.9", undefined)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", "2")).toBe("203.0.113.9");
  });
  it("ignores the header when no proxy is trusted, or it is junk", () => {
    expect(clientIp("203.0.113.9", "0")).toBeNull();
    expect(clientIp(null, undefined)).toBeNull();
    expect(clientIp("<script>", undefined)).toBeNull();
    expect(clientIp("1.2.3.4", "3")).toBeNull();
  });
  it("accepts IPv6", () => expect(clientIp("2001:db8::1", undefined)).toBe("2001:db8::1"));
});
