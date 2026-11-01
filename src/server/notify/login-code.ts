/**
 * Sends a parent login code straight away, not through the queue: a code that arrives after the next
 * scheduled run is useless. The message is still logged in `notification` (Messages screen), but with
 * the code masked, so nobody with database or admin access can read a parent's code.
 *
 * - Consent / opt-out don't apply: the parent asked for this message themselves.
 * - Not on WhatsApp → one SMS try, also immediately.
 * - Never retried later (the worker never picks these rows up: they are never QUEUED).
 */
import { eq } from "drizzle-orm";
import type { DbOrTx } from "@/db/client";
import { notification } from "@/db/schema";
import { CODE_TTL_MINUTES } from "@/lib/auth/otp";
import { dedupeKey } from "@/lib/notify/rules";
import { renderSms, renderWhatsApp, type Language, type MessageData } from "@/lib/notify/templates";
import type { Providers } from "./providers";

export const MASKED_CODE = "••••••";

export interface CodeRecipient {
  contactId: number;
  studentId: number;
  phone: string;
  language: Language;
  whatsappOk: boolean;
}

export type CodeResult = { sent: true; channel: "WHATSAPP" | "SMS" } | { sent: false; reason: string };

export async function sendLoginCode(db: Pick<DbOrTx, "insert" | "update">, providers: Providers, otpId: number, to: CodeRecipient, code: string): Promise<CodeResult> {
  const real: MessageData = { kind: "LOGIN_OTP", code, minutes: CODE_TTL_MINUTES };
  const masked: MessageData = { kind: "LOGIN_OTP", code: MASKED_CODE, minutes: CODE_TTL_MINUTES };
  const render = (channel: "WHATSAPP" | "SMS", d: MessageData) => (channel === "WHATSAPP" ? renderWhatsApp(d, to.language) : renderSms(d, to.language));

  const attempt = async (channel: "WHATSAPP" | "SMS", fallbackOf: number | null) => {
    const allowed = !providers.allowedNumbers || providers.allowedNumbers.has(to.phone);
    const [row] = await db
      .insert(notification)
      .values({
        dedupeKey: fallbackOf ? dedupeKey.smsFallback(dedupeKey.loginCode(otpId)) : dedupeKey.loginCode(otpId),
        trigger: "LOGIN_OTP",
        studentId: to.studentId,
        parentContactId: to.contactId,
        phone: to.phone,
        channel,
        template: "LOGIN_OTP",
        payload: { data: masked, text: render(channel, masked) },
        status: allowed ? "SENDING" : "SKIPPED",
        attempts: allowed ? 1 : 0,
        lastError: allowed ? null : "Not in NOTIFY_ALLOWED_NUMBERS (test mode)",
        fallbackOf,
      })
      .returning({ id: notification.id });
    if (!allowed) return { row: row.id, res: { ok: false as const, permanent: true, error: "test mode" } };

    const provider = channel === "WHATSAPP" ? providers.whatsapp : providers.sms;
    let res: Awaited<ReturnType<typeof provider.send>>;
    try {
      res = await provider.send({ id: row.id, phone: to.phone, channel, text: render(channel, real) });
    } catch (e) {
      res = { ok: false, permanent: false, error: `Provider crashed: ${(e as Error).message}` };
    }
    await db
      .update(notification)
      .set(
        res.ok
          ? { status: "SENT", provider: provider.name, providerMessageId: res.providerMessageId, sentAt: new Date(), updatedAt: new Date() }
          : { status: "FAILED", provider: provider.name, lastError: res.error, updatedAt: new Date() },
      )
      .where(eq(notification.id, row.id));
    return { row: row.id, res };
  };

  const first = to.whatsappOk ? "WHATSAPP" : "SMS";
  const a = await attempt(first, null);
  if (a.res.ok) return { sent: true, channel: first };
  if (first === "WHATSAPP" && "notOnWhatsApp" in a.res && a.res.notOnWhatsApp) {
    const b = await attempt("SMS", a.row);
    if (b.res.ok) return { sent: true, channel: "SMS" };
    return { sent: false, reason: b.res.error };
  }
  return { sent: false, reason: a.res.error };
}
