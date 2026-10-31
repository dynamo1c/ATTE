"use server";

import { and, count, eq, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db/client";
import { loginAttempt, staff } from "@/db/schema";
import type { ActionState } from "@/lib/action-state";
import { getDummyHash, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { normalizeIndianMobile } from "@/lib/domain/phone";
import { formDataToObject } from "@/lib/forms";
import { formAction, UserError } from "./action";
import { audit } from "./audit";
import { createSession, destroyCurrentSession, requestMeta, revokeSessions } from "./session";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_PHONE = 5;
const MAX_FAILS_PER_IP = 30;
const WRONG = "Phone number or password is wrong.";

/** Only same-site paths, never "//evil.com". */
function safeNext(next: unknown): string {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const raw = formDataToObject(fd);
  const password = typeof raw.password === "string" ? raw.password : "";
  const phoneResult = normalizeIndianMobile(typeof raw.phone === "string" ? raw.phone : "");
  if (!phoneResult.ok) return { ok: false, fieldErrors: { phone: [phoneResult.error] } };
  if (!password) return { ok: false, fieldErrors: { password: ["Enter your password"] } };
  const phone = phoneResult.value;

  const db = getDb();
  const { ip } = await requestMeta();
  const since = new Date(Date.now() - WINDOW_MS);
  const [byPhone] = await db.select({ n: count() }).from(loginAttempt).where(and(eq(loginAttempt.phone, phone), eq(loginAttempt.success, false), gt(loginAttempt.at, since)));
  const [byIp] = ip
    ? await db.select({ n: count() }).from(loginAttempt).where(and(eq(loginAttempt.ip, ip), eq(loginAttempt.success, false), gt(loginAttempt.at, since)))
    : [{ n: 0 }];
  if (byPhone.n >= MAX_FAILS_PER_PHONE || byIp.n >= MAX_FAILS_PER_IP) {
    return { ok: false, error: "Too many wrong attempts. Wait 15 minutes and try again, or ask the admin to reset your password." };
  }

  const [person] = await db.select().from(staff).where(and(eq(staff.phone, phone), eq(staff.active, true))).limit(1);
  // Always run one hash check so response time doesn't reveal whether the phone exists.
  const valid = await verifyPassword(password, person?.passwordHash ?? (await getDummyHash()));
  const success = Boolean(person?.passwordHash) && valid;
  await db.insert(loginAttempt).values({ phone, ip, success });
  if (!success || !person) return { ok: false, error: WRONG };

  await createSession(person.id);
  await audit(db, { actorStaffId: person.id, action: "LOGIN", entity: "staff", entityId: person.id, after: { ip } });
  redirect(person.mustChangePassword ? "/change-password" : safeNext(raw.next));
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

const changePasswordSchema = z
  .object({
    current: z.string().min(1, "Enter your current password"),
    next: z.string(),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const problem = passwordProblem(v.next);
    if (problem) ctx.addIssue({ code: "custom", path: ["next"], message: problem });
    if (v.next !== v.confirm) ctx.addIssue({ code: "custom", path: ["confirm"], message: "Passwords don't match" });
    if (v.next === v.current) ctx.addIssue({ code: "custom", path: ["next"], message: "Choose a different password from the current one" });
  });

export const changePasswordAction = formAction(
  changePasswordSchema,
  async (input, { me }) => {
    const db = getDb();
    const [row] = await db.select({ hash: staff.passwordHash }).from(staff).where(eq(staff.id, me.id));
    if (!row?.hash || !(await verifyPassword(input.current, row.hash))) {
      throw new UserError("Current password is wrong.", { current: ["Current password is wrong"] });
    }
    await db.transaction(async (tx) => {
      await tx.update(staff).set({ passwordHash: await hashPassword(input.next), mustChangePassword: false }).where(eq(staff.id, me.id));
      await audit(tx, { actorStaffId: me.id, action: "PASSWORD_CHANGED", entity: "staff", entityId: me.id });
    });
    await revokeSessions(me.id, true);
    redirect("/");
  },
  { allowPasswordChange: true },
);
