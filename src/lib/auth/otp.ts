/**
 * Parent login codes (docs/PLAN.md §3): register number + phone on record → 6-digit code → session.
 *
 * - The code is never stored. The row keeps sha256(challenge + code), where the challenge is a random
 *   token that only lives in the parent's cookie, so a database copy cannot be brute-forced offline.
 * - Requests are limited per phone and per IP; each code allows a few tries, once.
 * - Whether the register number and phone matched is never revealed: a mismatch gets a challenge too,
 *   and every code typed against it is "wrong".
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const MAX_CODE_TRIES = 5;
/** Wait between two codes for the same phone. */
export const RESEND_SECONDS = 60;
export const PHONE_WINDOW_MINUTES = 15;
export const MAX_PER_PHONE_WINDOW = 3;
export const MAX_PER_PHONE_DAY = 10;
export const MAX_PER_IP_WINDOW = 20;
export const PARENT_SESSION_DAYS = 30;

export function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export const codeHash = (challenge: string, code: string) => sha256(`${challenge}:${code}`);

/** Constant-time compare of two hex hashes. */
export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** What the parent typed: digits only, spaces ignored. */
export function cleanCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.replace(/\s/g, "");
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(c) ? c : null;
}

export interface RequestCounts {
  phoneInWindow: number;
  phoneInDay: number;
  ipInWindow: number;
  /** Latest code for this phone, if any. */
  lastForPhone: Date | null;
}

/** Why a new code can't be sent now, or null. Counts every request, matched or not. */
export function requestBlock(c: RequestCounts, now: Date): { error: string } | null {
  if (c.lastForPhone) {
    const wait = Math.ceil(RESEND_SECONDS - (now.getTime() - c.lastForPhone.getTime()) / 1000);
    if (wait > 0) return { error: `A code was just sent. Wait ${wait} seconds before asking for another.` };
  }
  if (c.phoneInDay >= MAX_PER_PHONE_DAY) return { error: "Too many codes asked for this number today. Try again tomorrow, or contact the class teacher." };
  if (c.phoneInWindow >= MAX_PER_PHONE_WINDOW || c.ipInWindow >= MAX_PER_IP_WINDOW) return { error: `Too many codes asked for. Wait ${PHONE_WINDOW_MINUTES} minutes and try again.` };
  return null;
}

/** "+919845012345" → "98••• •••45". */
export function maskPhone(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `${d.slice(0, 2)}••• •••${d.slice(-2)}`;
}

/** Register numbers are stored upper case without spaces (204CS25012). */
export function cleanRegNo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const r = raw.replace(/\s/g, "").toUpperCase();
  return /^[0-9]{3}[A-Z]{2}[0-9]{5}$/.test(r) ? r : null;
}
