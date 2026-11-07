"use server";

import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { getDb } from "@/db/client";
import { parentContact, parentOtp, student } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { cleanCode, cleanRegNo, CODE_TTL_MINUTES, codeHash, MAX_CODE_TRIES, newCode, newToken, PHONE_WINDOW_MINUTES, requestBlock, sameHash, sha256 } from "@/lib/auth/otp";
import { normalizeIndianMobile } from "@/lib/domain/phone";
import { sendLoginCode } from "./notify/login-code";
import { providersFor } from "./notify/providers";
import { toActionError } from "./action";
import { audit } from "./audit";
import { CHALLENGE_COOKIE, cookieBase, createParentSession, DEMO_COOKIE, destroyParentSession, PARENT_PATH, requireParent, VISIBLE_STATUSES } from "./parent-session";
import { requestMeta } from "./session";

/** With the mock provider nothing is really sent, so the code is shown on screen (never in production unless asked). */
function showDemoCode(env: NodeJS.ProcessEnv = process.env) {
  return (env.NOTIFY_PROVIDER ?? "mock") === "mock" && (env.NODE_ENV !== "production" || env.PARENT_OTP_DEMO === "yes");
}

async function clearChallenge() {
  const jar = await cookies();
  jar.delete({ name: CHALLENGE_COOKIE, path: PARENT_PATH });
  jar.delete({ name: DEMO_COOKIE, path: PARENT_PATH });
}

/** Step 1: register number + phone. Same answer whether or not they match (see src/lib/auth/otp.ts). */
export async function requestCodeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const regNo = cleanRegNo(fd.get("regNo"));
  const phoneResult = normalizeIndianMobile(String(fd.get("phone") ?? ""));
  const fieldErrors: Record<string, string[]> = {};
  if (!regNo) fieldErrors.regNo = ["Enter the register number as on the ID card, e.g. 204CS25012"];
  if (!phoneResult.ok) fieldErrors.phone = [phoneResult.error];
  if (!regNo || !phoneResult.ok) return { ok: false, fieldErrors };
  const phone = phoneResult.value;

  try {
    const db = getDb();
    const { ip } = await requestMeta();
    const challenge = newToken();
    const code = newCode();
    const now = new Date();

    const created = await db.transaction(async (tx) => {
      // One request at a time per phone, so two quick taps can't both pass the limits.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`parent_otp:${phone}`}))`);
      const { rows } = await tx.execute<{ phone_window: number; phone_day: number; ip_window: number; last_for_phone: string | null }>(sql`
        SELECT
          count(*) FILTER (WHERE phone = ${phone} AND created_at > ${now}::timestamptz - make_interval(mins => ${PHONE_WINDOW_MINUTES}))::int AS phone_window,
          count(*) FILTER (WHERE phone = ${phone})::int AS phone_day,
          count(*) FILTER (WHERE ip = ${ip} AND created_at > ${now}::timestamptz - make_interval(mins => ${PHONE_WINDOW_MINUTES}))::int AS ip_window,
          max(created_at) FILTER (WHERE phone = ${phone}) AS last_for_phone
        FROM parent_otp
        WHERE (phone = ${phone} OR ip = ${ip}) AND created_at > ${now}::timestamptz - interval '24 hours'`);
      const c = rows[0];
      const block = requestBlock(
        { phoneInWindow: c.phone_window, phoneInDay: c.phone_day, ipInWindow: ip ? c.ip_window : 0, lastForPhone: c.last_for_phone ? new Date(c.last_for_phone) : null },
        now,
      );
      if (block) return block;

      const [match] = await tx
        .select({ contactId: parentContact.id, studentId: student.id, phone: parentContact.phone, language: parentContact.language, whatsappOk: parentContact.whatsappOk })
        .from(parentContact)
        .innerJoin(student, eq(student.id, parentContact.studentId))
        .where(and(eq(student.regNo, regNo), eq(parentContact.phone, phone), inArray(student.status, [...VISIBLE_STATUSES])))
        .orderBy(asc(parentContact.id))
        .limit(1);
      const [row] = await tx
        .insert(parentOtp)
        .values({
          challengeHash: sha256(challenge),
          codeHash: codeHash(challenge, code),
          phone,
          regNo,
          parentContactId: match?.contactId ?? null,
          ip,
          expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
        })
        .returning({ id: parentOtp.id });
      return { otpId: row.id, match: match ?? null };
    });
    if ("error" in created) return { ok: false, error: created.error };

    const demo = showDemoCode();
    if (created.match) {
      let result: Awaited<ReturnType<typeof sendLoginCode>>;
      try {
        result = await sendLoginCode(db, await providersFor(db), created.otpId, created.match, code);
      } catch (e) {
        console.error("Login code not sent", e);
        result = { sent: false, reason: "provider error" };
      }
      if (!result.sent && !demo) return { ok: false, error: "We couldn't send the code just now. Please try again in a few minutes." };
    }

    const jar = await cookies();
    jar.set(CHALLENGE_COOKIE, challenge, { ...cookieBase, maxAge: CODE_TTL_MINUTES * 60 });
    if (demo && created.match) jar.set(DEMO_COOKIE, code, { ...cookieBase, maxAge: CODE_TTL_MINUTES * 60 });
    else jar.delete({ name: DEMO_COOKIE, path: PARENT_PATH });
  } catch (e) {
    unstable_rethrow(e);
    return toActionError(e);
  }
  redirect("/parent/login");
}

/** Step 2: the 6-digit code. */
export async function verifyCodeAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const code = cleanCode(fd.get("code"));
  if (!code) return { ok: false, fieldErrors: { code: ["Enter the 6-digit code"] } };
  const challenge = (await cookies()).get(CHALLENGE_COOKIE)?.value;
  const expired: ActionState = { ok: false, error: "This code has expired. Ask for a new one." };
  if (!challenge) return expired;

  try {
    const db = getDb();
    // Count the try first, atomically, so parallel guesses can't exceed the limit.
    const [row] = await db
      .update(parentOtp)
      .set({ tries: sql`${parentOtp.tries} + 1` })
      .where(and(eq(parentOtp.challengeHash, sha256(challenge)), isNull(parentOtp.usedAt), gt(parentOtp.expiresAt, new Date()), sql`${parentOtp.tries} < ${MAX_CODE_TRIES}`))
      .returning({ id: parentOtp.id, codeHash: parentOtp.codeHash, phone: parentOtp.phone, contactId: parentOtp.parentContactId, tries: parentOtp.tries });
    if (!row) {
      await clearChallenge();
      return expired;
    }
    const right = row.contactId !== null && sameHash(codeHash(challenge, code), row.codeHash);
    if (!right) {
      const left = MAX_CODE_TRIES - row.tries;
      if (left <= 0) {
        await clearChallenge();
        return { ok: false, error: "Too many wrong codes. Ask for a new one." };
      }
      return { ok: false, error: `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.`, fieldErrors: { code: ["Wrong code"] } };
    }
    const used = await db.update(parentOtp).set({ usedAt: new Date() }).where(and(eq(parentOtp.id, row.id), isNull(parentOtp.usedAt))).returning({ id: parentOtp.id });
    if (!used.length) {
      await clearChallenge();
      return expired;
    }
    await createParentSession(row.phone);
    await clearChallenge();
    const { ip } = await requestMeta();
    await audit(db, { actorStaffId: null, action: "PARENT_LOGIN", entity: "parent_contact", entityId: row.contactId!, after: { ip } });
  } catch (e) {
    unstable_rethrow(e);
    return toActionError(e);
  }
  redirect("/parent");
}

export async function startOverAction(): Promise<void> {
  await clearChallenge();
  redirect("/parent/login");
}

export async function parentLogoutAction(): Promise<void> {
  await destroyParentSession();
  redirect("/parent/login");
}

/** Parents can stop non-urgent messages (DPDP). Shortage, absence and login codes still come. */
export async function setOptOutAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const me = await requireParent();
  const optOut = fd.get("optOut") === "yes";
  try {
    const db = getDb();
    await db.transaction(async (tx) => {
      const changed = await tx
        .update(parentContact)
        .set({ optedOutAt: optOut ? new Date() : null })
        .where(and(eq(parentContact.phone, me.phone), optOut ? isNull(parentContact.optedOutAt) : sql`${parentContact.optedOutAt} IS NOT NULL`))
        .returning({ id: parentContact.id });
      for (const c of changed) await audit(tx, { actorStaffId: null, action: optOut ? "PARENT_OPT_OUT" : "PARENT_OPT_IN", entity: "parent_contact", entityId: c.id });
    });
  } catch (e) {
    unstable_rethrow(e);
    return toActionError(e);
  }
  revalidatePath("/parent", "layout");
  return { ok: true, message: optOut ? "Done. You will now get only urgent messages." : "Done. You will get all updates again." };
}
