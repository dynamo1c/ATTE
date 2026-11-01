import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, ne } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db/client";
import { clientIp } from "@/lib/auth/client-ip";
import { staffSession } from "@/db/schema";

export const SESSION_COOKIE = "mei_session";
const SESSION_DAYS = 30;
/** Don't write last_seen_at on every request. */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;
/** Signed out after this long without use (shared lab / staff-room computers), even inside the 30 days. */
const IDLE_MS = (Number(process.env.SESSION_IDLE_HOURS) || 72) * 60 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestMeta() {
  const h = await headers();
  return { ip: clientIp(h.get("x-forwarded-for"), process.env.TRUSTED_PROXY_HOPS), userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

/** Call only from a Server Action (sets a cookie). */
export async function createSession(staffId: number): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const meta = await requestMeta();
  await getDb().insert(staffSession).values({ tokenHash: hashToken(token), staffId, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

/** Staff id for the current request's session, or null. Safe to call while rendering. */
export async function readSessionStaffId(): Promise<number | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const tokenHash = hashToken(token);
  const [row] = await db
    .select({ staffId: staffSession.staffId, lastSeenAt: staffSession.lastSeenAt })
    .from(staffSession)
    .where(and(eq(staffSession.tokenHash, tokenHash), gt(staffSession.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  const idle = Date.now() - row.lastSeenAt.getTime();
  if (idle > IDLE_MS) {
    await db.delete(staffSession).where(eq(staffSession.tokenHash, tokenHash));
    return null;
  }
  if (idle > TOUCH_INTERVAL_MS) {
    await db.update(staffSession).set({ lastSeenAt: new Date() }).where(eq(staffSession.tokenHash, tokenHash));
  }
  return row.staffId;
}

export function currentTokenHash(token: string | undefined) {
  return token ? hashToken(token) : null;
}

/** Call only from a Server Action. */
export async function destroyCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await getDb().delete(staffSession).where(eq(staffSession.tokenHash, hashToken(token)));
  jar.delete(SESSION_COOKIE);
}

/** Log a person out everywhere (password reset, deactivation). Optionally keep the current device. */
export async function revokeSessions(staffId: number, keepCurrent = false): Promise<void> {
  const db = getDb();
  if (keepCurrent) {
    const keep = currentTokenHash((await cookies()).get(SESSION_COOKIE)?.value);
    if (keep) {
      await db.delete(staffSession).where(and(eq(staffSession.staffId, staffId), ne(staffSession.tokenHash, keep)));
      return;
    }
  }
  await db.delete(staffSession).where(eq(staffSession.staffId, staffId));
}
