import { describe, expect, it } from "vitest";
import { changedFields, show } from "./audit-diff";

describe("audit diff", () => {
  it("lists only fields that changed, ignoring housekeeping", () => {
    expect(changedFields({ phone: "+911", name: "A", version: 1 }, { phone: "+912", name: "A", version: 2 })).toEqual([{ field: "phone", before: "+911", after: "+912" }]);
  });
  it("handles a create or delete (one side missing)", () => {
    expect(changedFields(null, { name: "B" })).toEqual([{ field: "name", before: "—", after: "B" }]);
    expect(changedFields({ name: "B" }, null)).toEqual([{ field: "name", before: "B", after: "—" }]);
    expect(changedFields(null, null)).toEqual([]);
    expect(changedFields("x", [1])).toEqual([]);
  });
  it("summarises long values and lists", () => {
    expect(show("x".repeat(100))).toHaveLength(60);
    expect(show([1, 2, 3])).toBe("3 items");
    expect(show({ a: 1 })).toBe('{"a":1}');
  });
});
