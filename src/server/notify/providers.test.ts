import { describe, expect, it } from "vitest";
import { providersFromEnv, TwilioWhatsAppProvider } from "./providers";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;
const msg = { id: 7, phone: "+919845012345", channel: "WHATSAPP" as const, text: "Hello" };

/** A fetch that records the request and answers with `status` / `body`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("TwilioWhatsAppProvider", () => {
  it("posts a form with whatsapp: numbers and basic auth, and returns the message SID", async () => {
    const f = fakeFetch(201, { sid: "SM123", status: "queued" });
    const r = await new TwilioWhatsAppProvider("AC1", "secret", "+14155238886", f.fn).send(msg);
    expect(r).toEqual({ ok: true, providerMessageId: "SM123" });
    expect(f.calls[0].url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC1/Messages.json");
    const form = new URLSearchParams(String(f.calls[0].init.body));
    expect(form.get("To")).toBe("whatsapp:+919845012345");
    expect(form.get("From")).toBe("whatsapp:+14155238886");
    expect(form.get("Body")).toBe("Hello");
    expect((f.calls[0].init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("AC1:secret").toString("base64")}`);
  });

  it("explains errors the admin can fix and marks them permanent", async () => {
    const f = fakeFetch(400, { code: 63015, message: "Channel Sandbox can only send messages to phone numbers that have joined the Sandbox", status: 400 });
    const r = await new TwilioWhatsAppProvider("AC1", "s", "+1", f.fn).send(msg);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.permanent).toBe(true);
      expect(r.error).toMatch(/#63015.*joined the Twilio sandbox/);
    }
  });

  it("wrong credentials are permanent; rate limits and server errors retry", async () => {
    const auth = await new TwilioWhatsAppProvider("AC1", "s", "+1", fakeFetch(401, { code: 20003, message: "Authenticate" }).fn).send(msg);
    expect(auth.ok === false && auth.permanent && /TWILIO_AUTH_TOKEN/.test(auth.error)).toBe(true);
    const busy = await new TwilioWhatsAppProvider("AC1", "s", "+1", fakeFetch(429, { code: 20429, message: "Too Many Requests" }).fn).send(msg);
    expect(busy.ok === false && !busy.permanent).toBe(true);
    const down = await new TwilioWhatsAppProvider("AC1", "s", "+1", fakeFetch(503, null).fn).send(msg);
    expect(down.ok === false && !down.permanent).toBe(true);
  });

  it("a number not on WhatsApp is flagged so critical messages fall back to SMS", async () => {
    const r = await new TwilioWhatsAppProvider("AC1", "s", "+1", fakeFetch(400, { code: 63003, message: "Channel could not find To address" }).fn).send(msg);
    expect(r.ok === false && r.notOnWhatsApp === true).toBe(true);
  });

  it("network failure retries; SMS is refused", async () => {
    const boom = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const r = await new TwilioWhatsAppProvider("AC1", "s", "+1", boom).send(msg);
    expect(r.ok === false && !r.permanent && /offline/.test(r.error)).toBe(true);
    const sms = await new TwilioWhatsAppProvider("AC1", "s", "+1", boom).send({ ...msg, channel: "SMS" });
    expect(sms.ok === false && sms.permanent).toBe(true);
  });
});

describe("providersFromEnv", () => {
  const twilio = { NOTIFY_PROVIDER: "twilio", TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "s", TWILIO_WHATSAPP_FROM: "whatsapp:+1 415 523 8886", NOTIFY_ALLOWED_NUMBERS: "+919845012345" };

  it("builds the Twilio sender and cleans the From number", () => {
    const p = providersFromEnv(env(twilio));
    expect(p.real).toBe(true);
    expect(p.whatsapp.name).toBe("twilio_whatsapp");
    expect(p.allowedNumbers?.has("+919845012345")).toBe(true);
    expect(p.monthlyLimit).toBeNull();
  });

  it("refuses missing settings, a bad From number and sending to everyone", () => {
    expect(() => providersFromEnv(env({ ...twilio, TWILIO_AUTH_TOKEN: "" }))).toThrow(/TWILIO_AUTH_TOKEN/);
    expect(() => providersFromEnv(env({ ...twilio, TWILIO_WHATSAPP_FROM: "sandbox" }))).toThrow(/TWILIO_WHATSAPP_FROM/);
    expect(() => providersFromEnv(env({ ...twilio, NOTIFY_ALLOWED_NUMBERS: "" }))).toThrow(/everyone/);
    expect(() => providersFromEnv(env({ NOTIFY_PROVIDER: "sms-magic" }))).toThrow(/twilio/);
  });

  it("reads the monthly cap and rejects nonsense", () => {
    expect(providersFromEnv(env({ ...twilio, NOTIFY_MONTHLY_LIMIT: "90" })).monthlyLimit).toBe(90);
    expect(providersFromEnv(env({ ...twilio, NOTIFY_MONTHLY_LIMIT: " " })).monthlyLimit).toBeNull();
    expect(() => providersFromEnv(env({ ...twilio, NOTIFY_MONTHLY_LIMIT: "lots" }))).toThrow(/whole number/);
    expect(() => providersFromEnv(env({ ...twilio, NOTIFY_MONTHLY_LIMIT: "-1" }))).toThrow(/whole number/);
  });
});
