import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt, ne } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { getDb } from "@/db/client";
import { staffSession } from "@/db/schema";

export const SESSION_COOKIE = "mei_session";
const SESSION_DAYS = 30;
/** Don't write last_seen_at on every request. */
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
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
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
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

export async function purgeExpiredSessions(): Promise<void> {
  await getDb().delete(staffSession).where(lt(staffSession.expiresAt, new Date()));
}
