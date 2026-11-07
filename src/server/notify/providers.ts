/**
 * Message providers (docs/PLAN.md §8.4). The rest of the code only sees `MessageProvider`, so
 * switching from the mock to WhatsApp Cloud API, a BSP or an SMS gateway is a config change.
 *
 * Choose with env NOTIFY_PROVIDER:
 *   mock      (default) nothing leaves the server; messages show on the Messages screen as "sent".
 *   whatsapp  Meta WhatsApp Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID).
 *   twilio    WhatsApp through Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM).
 *             Works with Twilio's sandbox, without a verified Meta business account.
 *   With either real sender SMS stays unconfigured until a DLT-registered SMS provider is added, so SMS
 *   rows fail with a clear error.
 *
 * Cost: NOTIFY_MONTHLY_LIMIT (a whole number) caps real messages per calendar month; past it, messages
 * are SKIPPED with a clear reason instead of being sent and billed.
 *
 * Safety: NOTIFY_ALLOWED_NUMBERS (comma separated, e.g. "+919845012345") limits real sends to those
 * numbers; everything else is marked SKIPPED. Always set it while the database holds dummy data:
 * providersFor() refuses NOTIFY_ALLOW_ALL=yes while the dummy-data flag is set.
 */
import { sql } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
export type Channel = "WHATSAPP" | "SMS";

export interface OutgoingMessage {
  id: number;
  phone: string;
  channel: Channel;
  text: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string }
  | { ok: false; permanent: boolean; notOnWhatsApp?: boolean; error: string };

export interface MessageProvider {
  name: string;
  send(m: OutgoingMessage): Promise<SendResult>;
}

/** Pretends to send. `failNumbers` simulate a number that is not on WhatsApp (to demo the SMS fallback). */
export class MockProvider implements MessageProvider {
  name = "mock";
  constructor(private failNumbers: ReadonlySet<string> = new Set()) {}
  async send(m: OutgoingMessage): Promise<SendResult> {
    if (m.channel === "WHATSAPP" && this.failNumbers.has(m.phone)) return { ok: false, permanent: true, notOnWhatsApp: true, error: "Mock: number is not on WhatsApp" };
    return { ok: true, providerMessageId: `mock-${m.channel.toLowerCase()}-${m.id}` };
  }
}

/** Used when a channel has no provider configured: fails clearly instead of pretending. */
export class UnconfiguredProvider implements MessageProvider {
  constructor(public name: string) {}
  async send(): Promise<SendResult> {
    return { ok: false, permanent: true, error: `No ${this.name} provider is configured.` };
  }
}

// Meta error codes: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
const NOT_ON_WHATSAPP = new Set([131026]);
/** Errors whose cause the admin can fix; shown instead of Meta's wording. */
const EXPLAIN: Record<number, string> = {
  131047: "More than 24 hours since this number last messaged the college number, so Meta only allows an approved template. Ask them to send \"hi\" to the college WhatsApp number, then retry.",
  131030: "This number is not on the test sender's list in Meta (WhatsApp → API setup → To). Add and verify it there.",
  190: "The WhatsApp access token has expired or is wrong. Make a new one in Meta and update WHATSAPP_TOKEN.",
  100: "Meta rejected the request (check WHATSAPP_PHONE_NUMBER_ID).",
};
const RETRYABLE = new Set([1, 2, 4, 80007, 130429, 131000, 131016, 131048, 131056, 133004]);

/**
 * WhatsApp Cloud API. Sends plain text, which Meta delivers only inside the 24-hour window after the
 * parent last messaged the college number — enough for the free test number demo. Production needs
 * approved utility templates (see docs/PLAN.md §8.4); add them here when the college's account exists.
 */
export class WhatsAppCloudProvider implements MessageProvider {
  name = "whatsapp_cloud";
  constructor(
    private token: string,
    private phoneNumberId: string,
    private apiVersion = "v21.0",
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(m: OutgoingMessage): Promise<SendResult> {
    if (m.channel !== "WHATSAPP") return { ok: false, permanent: true, error: "WhatsApp provider cannot send SMS." };
    let res: Response;
    try {
      res = await this.fetchFn(`https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(this.phoneNumberId)}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: m.phone.replace(/^\+/, ""), type: "text", text: { body: m.text, preview_url: false } }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, permanent: false, error: `Network: ${(e as Error).message}` };
    }
    const body = (await res.json().catch(() => null)) as { messages?: { id: string }[]; error?: { code?: number; message?: string } } | null;
    const id = body?.messages?.[0]?.id;
    if (res.ok && id) return { ok: true, providerMessageId: id };
    const code = body?.error?.code;
    const error = `WhatsApp ${res.status}${code ? ` #${code}` : ""}: ${(code !== undefined && EXPLAIN[code]) || body?.error?.message || "unexpected response"}`.slice(0, 500);
    if (code !== undefined && NOT_ON_WHATSAPP.has(code)) return { ok: false, permanent: true, notOnWhatsApp: true, error };
    const retry = res.status >= 500 || res.status === 429 || (code !== undefined && RETRYABLE.has(code));
    return { ok: false, permanent: !retry, error };
  }
}

// Twilio error codes: https://www.twilio.com/docs/api/errors
const TWILIO_NOT_ON_WHATSAPP = new Set([63003]);
const TWILIO_EXPLAIN: Record<number, string> = {
  20003: "Twilio rejected the Account SID / Auth Token. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.",
  21211: "Twilio says this phone number is not valid.",
  21654: "This Twilio sender only accepts approved templates, not plain text (the Twilio trial sender is like this). Use the WhatsApp sandbox number (Messaging → Settings → WhatsApp sandbox settings) or the college's own sender.",
  63007: "Twilio does not know the sender TWILIO_WHATSAPP_FROM. Use the WhatsApp sandbox number shown in Twilio.",
  63015: "This number has not joined the Twilio sandbox. Send the \"join …\" code from that WhatsApp to the sandbox number, then retry.",
  63016: "More than 24 hours since this number last messaged the sender, so only an approved template is allowed. Send any message to the sandbox number, then retry.",
  63038: "The Twilio account has reached its daily message limit (trial accounts are limited).",
};
const TWILIO_RETRYABLE = new Set([20429, 63018]);

/**
 * WhatsApp through Twilio's Messages API. Plain text, so (like Meta) it reaches a number only within
 * 24 hours of that number messaging the sender; with the sandbox the number must also have joined it.
 * Twilio answers "queued" when it accepts a message; problems found later show only in the Twilio
 * console (Monitor → Logs), because this app has no public address for delivery callbacks.
 */
export class TwilioWhatsAppProvider implements MessageProvider {
  name = "twilio_whatsapp";
  constructor(
    private accountSid: string,
    private authToken: string,
    private from: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async send(m: OutgoingMessage): Promise<SendResult> {
    if (m.channel !== "WHATSAPP") return { ok: false, permanent: true, error: "Twilio WhatsApp provider cannot send SMS." };
    const form = new URLSearchParams({ To: `whatsapp:${m.phone}`, From: `whatsapp:${this.from}`, Body: m.text.slice(0, 1600) });
    let res: Response;
    try {
      res = await this.fetchFn(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      return { ok: false, permanent: false, error: `Network: ${(e as Error).message}` };
    }
    const body = (await res.json().catch(() => null)) as { sid?: string; status?: string; code?: number; message?: string; error_code?: number | null; error_message?: string | null } | null;
    if (res.ok && body?.sid && body.status !== "failed" && body.status !== "undelivered") return { ok: true, providerMessageId: body.sid };
    const code = body?.code ?? body?.error_code ?? null;
    const error = `Twilio ${res.status}${code ? ` #${code}` : ""}: ${(code !== null && TWILIO_EXPLAIN[code]) || body?.message || body?.error_message || "unexpected response"}`.slice(0, 500);
    if (code !== null && TWILIO_NOT_ON_WHATSAPP.has(code)) return { ok: false, permanent: true, notOnWhatsApp: true, error };
    const retry = res.status >= 500 || res.status === 429 || (code !== null && TWILIO_RETRYABLE.has(code));
    return { ok: false, permanent: !retry, error };
  }
}

export interface Providers {
  whatsapp: MessageProvider;
  sms: MessageProvider;
  /** null = no restriction. */
  allowedNumbers: ReadonlySet<string> | null;
  /** True when messages really leave the server (not the mock). */
  real: boolean;
  /** Most real messages per calendar month (NOTIFY_MONTHLY_LIMIT); null / missing = no cap. Ignored for the mock. */
  monthlyLimit?: number | null;
}

const list = (v: string | undefined) => new Set((v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Providers {
  const allowed = list(env.NOTIFY_ALLOWED_NUMBERS);
  const allowedNumbers = allowed.size ? allowed : null;
  const mode = env.NOTIFY_PROVIDER ?? "mock";
  const monthlyLimit = parseLimit(env.NOTIFY_MONTHLY_LIMIT);
  const refuseEveryone = () => {
    if (!allowedNumbers && env.NOTIFY_ALLOW_ALL !== "yes") {
      throw new Error("Refusing to send real WhatsApp messages to everyone: set NOTIFY_ALLOWED_NUMBERS, or NOTIFY_ALLOW_ALL=yes once real data is loaded.");
    }
  };
  if (mode === "mock") {
    const mock = new MockProvider(list(env.MOCK_NOT_ON_WHATSAPP));
    return { whatsapp: mock, sms: mock, allowedNumbers, real: false };
  }
  if (mode === "whatsapp") {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("NOTIFY_PROVIDER=whatsapp needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
    refuseEveryone();
    return { whatsapp: new WhatsAppCloudProvider(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_API_VERSION || undefined), sms: new UnconfiguredProvider("SMS"), allowedNumbers, real: true, monthlyLimit };
  }
  if (mode === "twilio") {
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_WHATSAPP_FROM) {
      throw new Error("NOTIFY_PROVIDER=twilio needs TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM.");
    }
    const from = env.TWILIO_WHATSAPP_FROM.replace(/^whatsapp:/, "").replace(/[\s-]/g, "");
    if (!/^\+\d{8,15}$/.test(from)) throw new Error("TWILIO_WHATSAPP_FROM must be a phone number with country code, like +14155238886.");
    refuseEveryone();
    return { whatsapp: new TwilioWhatsAppProvider(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, from), sms: new UnconfiguredProvider("SMS"), allowedNumbers, real: true, monthlyLimit };
  }
  throw new Error(`Unknown NOTIFY_PROVIDER "${mode}". Use "mock", "whatsapp" or "twilio".`);
}

function parseLimit(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v.trim());
  if (!Number.isInteger(n) || n < 0) throw new Error(`NOTIFY_MONTHLY_LIMIT must be a whole number (got "${v}").`);
  return n;
}

/**
 * Real (non-mock) messages handed to a provider this calendar month, in college time (every connection runs
 * in Asia/Kolkata). Counted by sent_at, so a message later marked DELIVERED / READ / FAILED still counts (it was billed).
 */
export async function realSentThisMonth(db: Pick<DbOrTx, "execute">): Promise<number> {
  const { rows } = await db.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM notification
    WHERE sent_at >= date_trunc('month', now()) AND provider IS NOT NULL AND provider <> 'mock'`);
  return rows[0]?.n ?? 0;
}

/** How many more real messages may go out this month; Infinity when there is no cap or the sender is the mock. */
export async function remainingThisMonth(db: Pick<DbOrTx, "execute">, providers: Providers): Promise<number> {
  if (!providers.real || providers.monthlyLimit == null) return Infinity;
  return Math.max(0, providers.monthlyLimit - (await realSentThisMonth(db)));
}

export const limitReachedError = (providers: Providers) => `Monthly message limit reached (NOTIFY_MONTHLY_LIMIT=${providers.monthlyLimit}); not sent.`;

/**
 * Providers from env, refusing to message every number while the dummy college is loaded: its parent
 * numbers are made up and could belong to real people. Use this, not providersFromEnv, before sending.
 */
export async function providersFor(db: Pick<DbOrTx, "execute">, env: NodeJS.ProcessEnv = process.env): Promise<Providers> {
  const providers = providersFromEnv(env);
  if (providers.real && !providers.allowedNumbers) {
    const { rows } = await db.execute<{ demo: boolean }>(sql`SELECT demo_data AS demo FROM college_settings WHERE id = 1`);
    if (rows[0]?.demo !== false) {
      throw new Error("Refusing to send real messages to every parent: the database holds dummy data. Set NOTIFY_ALLOWED_NUMBERS to your own test numbers.");
    }
  }
  return providers;
}
