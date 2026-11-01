/**
 * Message providers (docs/PLAN.md §8.4). The rest of the code only sees `MessageProvider`, so
 * switching from the mock to WhatsApp Cloud API, a BSP or an SMS gateway is a config change.
 *
 * Choose with env NOTIFY_PROVIDER:
 *   mock      (default) nothing leaves the server; messages show on the Messages screen as "sent".
 *   whatsapp  Meta WhatsApp Cloud API (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID). SMS stays unconfigured
 *             until a DLT-registered SMS provider is added, so SMS rows fail with a clear error.
 *
 * Safety: NOTIFY_ALLOWED_NUMBERS (comma separated, e.g. "+919845012345") limits real sends to those
 * numbers; everything else is marked SKIPPED. Always set it while the database holds dummy data.
 */
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
    const error = `WhatsApp ${res.status}${code ? ` #${code}` : ""}: ${body?.error?.message ?? "unexpected response"}`.slice(0, 500);
    if (code !== undefined && NOT_ON_WHATSAPP.has(code)) return { ok: false, permanent: true, notOnWhatsApp: true, error };
    const retry = res.status >= 500 || res.status === 429 || (code !== undefined && RETRYABLE.has(code));
    return { ok: false, permanent: !retry, error };
  }
}

export interface Providers {
  whatsapp: MessageProvider;
  sms: MessageProvider;
  /** null = no restriction. */
  allowedNumbers: ReadonlySet<string> | null;
}

const list = (v: string | undefined) => new Set((v ?? "").split(",").map((s) => s.trim()).filter(Boolean));

export function providersFromEnv(env: NodeJS.ProcessEnv = process.env): Providers {
  const allowed = list(env.NOTIFY_ALLOWED_NUMBERS);
  const allowedNumbers = allowed.size ? allowed : null;
  const mode = env.NOTIFY_PROVIDER ?? "mock";
  if (mode === "mock") {
    const mock = new MockProvider(list(env.MOCK_NOT_ON_WHATSAPP));
    return { whatsapp: mock, sms: mock, allowedNumbers };
  }
  if (mode === "whatsapp") {
    if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("NOTIFY_PROVIDER=whatsapp needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.");
    if (!allowedNumbers && env.NOTIFY_ALLOW_ALL !== "yes") {
      throw new Error("Refusing to send real WhatsApp messages to everyone: set NOTIFY_ALLOWED_NUMBERS, or NOTIFY_ALLOW_ALL=yes once real data is loaded.");
    }
    return { whatsapp: new WhatsAppCloudProvider(env.WHATSAPP_TOKEN, env.WHATSAPP_PHONE_NUMBER_ID, env.WHATSAPP_API_VERSION || undefined), sms: new UnconfiguredProvider("SMS"), allowedNumbers };
  }
  throw new Error(`Unknown NOTIFY_PROVIDER "${mode}". Use "mock" or "whatsapp".`);
}
