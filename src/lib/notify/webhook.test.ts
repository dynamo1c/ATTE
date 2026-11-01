import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseStatuses, shouldApply, verifySignature } from "./webhook";

describe("verifySignature", () => {
  const body = '{"entry":[]}';
  const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
  it("accepts Meta's signature and rejects anything else", () => {
    expect(verifySignature(body, sig, "s3cret")).toBe(true);
    expect(verifySignature(body + " ", sig, "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "other")).toBe(false);
    expect(verifySignature(body, null, "s3cret")).toBe(false);
    expect(verifySignature(body, "sha256=abc", "s3cret")).toBe(false);
    expect(verifySignature(body, sig, "")).toBe(false);
  });
});

describe("parseStatuses", () => {
  it("reads delivery statuses and errors", () => {
    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { id: "wamid.1", status: "delivered" },
                  { id: "wamid.2", status: "failed", errors: [{ code: 131026, title: "Message undeliverable" }] },
                  { id: "wamid.3", status: "weird" },
                  { status: "read" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseStatuses(body)).toEqual([
      { providerMessageId: "wamid.1", status: "DELIVERED", errorCode: null, error: null },
      { providerMessageId: "wamid.2", status: "FAILED", errorCode: 131026, error: "Message undeliverable" },
    ]);
  });

  it("ignores junk without throwing", () => {
    for (const junk of [null, 1, "x", {}, { entry: "x" }, { entry: [{ changes: [null] }] }]) expect(parseStatuses(junk)).toEqual([]);
  });
});

describe("shouldApply", () => {
  it("only moves forward", () => {
    expect(shouldApply("SENT", "DELIVERED")).toBe(true);
    expect(shouldApply("DELIVERED", "READ")).toBe(true);
    expect(shouldApply("READ", "DELIVERED")).toBe(false);
    expect(shouldApply("DELIVERED", "SENT")).toBe(false);
    expect(shouldApply("SENT", "FAILED")).toBe(true);
    expect(shouldApply("DELIVERED", "FAILED")).toBe(false);
    expect(shouldApply("QUEUED", "DELIVERED")).toBe(false);
    expect(shouldApply("FAILED", "READ")).toBe(false);
  });
});
