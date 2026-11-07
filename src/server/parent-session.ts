import "server-only";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { classGroup, classMembership, department, parentContact, parentSession, student } from "@/db/schema";
import { newToken, PARENT_SESSION_DAYS, sha256 } from "@/lib/auth/otp";
import { getCurrentTerm } from "./queries";
import { requestMeta, SECURE_COOKIES } from "./session";

/** Cookies live under /parent only: they are never sent to staff pages, and staff cookies are separate. */
export const PARENT_COOKIE = "mei_parent";
export const CHALLENGE_COOKIE = "mei_parent_otp";
/** Demo only (mock provider): the code to show on screen, since nothing is really sent. */
export const DEMO_COOKIE = "mei_parent_demo";
export const PARENT_PATH = "/parent";
const TOUCH_INTERVAL_MS = 15 * 60 * 1000;

/** Students whose status still lets parents sign in and see them. */
export const VISIBLE_STATUSES = ["ACTIVE", "DETAINED"] as const;

export const cookieBase = { httpOnly: true, secure: SECURE_COOKIES, sameSite: "lax" as const, path: PARENT_PATH };

/** Call only from a Server Action. */
export async function createParentSession(phone: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + PARENT_SESSION_DAYS * 24 * 60 * 60 * 1000);
  const meta = await requestMeta();
  await getDb().insert(parentSession).values({ tokenHash: sha256(token), phone, expiresAt, ip: meta.ip, userAgent: meta.userAgent });
  (await cookies()).set(PARENT_COOKIE, token, { ...cookieBase, expires: expiresAt });
}

/** Call only from a Server Action. */
export async function destroyParentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(PARENT_COOKIE)?.value;
  if (token) await getDb().delete(parentSession).where(eq(parentSession.tokenHash, sha256(token)));
  jar.delete({ name: PARENT_COOKIE, path: PARENT_PATH });
}

async function readParentPhone(): Promise<string | null> {
  const token = (await cookies()).get(PARENT_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const tokenHash = sha256(token);
  const [row] = await db
    .select({ phone: parentSession.phone, lastSeenAt: parentSession.lastSeenAt })
    .from(parentSession)
    .where(and(eq(parentSession.tokenHash, tokenHash), gt(parentSession.expiresAt, new Date())))
    .limit(1);
  if (!row) return null;
  if (Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(parentSession).set({ lastSeenAt: new Date() }).where(eq(parentSession.tokenHash, tokenHash));
  }
  return row.phone;
}

export interface Child {
  id: number;
  name: string;
  regNo: string;
  status: string;
  /** Current class this term, if any. */
  classId: number | null;
  /** Department of that class. */
  departmentId: number | null;
  className: string | null;
}

export interface CurrentParent {
  phone: string;
  children: Child[];
}

/**
 * The signed-in parent and the children linked to their number right now. Looked up on every
 * request, so a number removed by the class teacher stops working at once.
 */
export const getCurrentParent = cache(async (): Promise<CurrentParent | null> => {
  const phone = await readParentPhone();
  if (!phone) return null;
  const db = getDb();
  const term = await getCurrentTerm();
  const rows = await db
    .selectDistinct({
      id: student.id,
      name: student.name,
      regNo: student.regNo,
      status: student.status,
      classId: classGroup.id,
      departmentId: classGroup.departmentId,
      deptCode: department.code,
      semester: classGroup.semester,
    })
    .from(parentContact)
    .innerJoin(student, eq(student.id, parentContact.studentId))
    .leftJoin(
      classMembership,
      and(eq(classMembership.studentId, student.id), eq(classMembership.termId, term?.id ?? -1), isNull(classMembership.leftOn)),
    )
    .leftJoin(classGroup, eq(classGroup.id, classMembership.classGroupId))
    .leftJoin(department, eq(department.id, classGroup.departmentId))
    .where(and(eq(parentContact.phone, phone), inArray(student.status, [...VISIBLE_STATUSES])))
    .orderBy(asc(student.name));
  return {
    phone,
    children: rows.map((r) => ({ id: r.id, name: r.name, regNo: r.regNo, status: r.status, classId: r.classId, departmentId: r.departmentId, className: r.deptCode ? `${r.deptCode} Sem ${r.semester}` : null })),
  };
});

/** Use at the top of every parent page. */
export async function requireParent(): Promise<CurrentParent> {
  const p = await getCurrentParent();
  if (!p) redirect("/parent/login");
  return p;
}

/** Whether every number this parent signed in with is opted out of non-urgent messages. */
export async function parentOptedOut(phone: string): Promise<boolean> {
  const [r] = await getDb()
    .select({ total: sql<number>`count(*)::int`, out: sql<number>`count(${parentContact.optedOutAt})::int` })
    .from(parentContact)
    .where(eq(parentContact.phone, phone));
  return r.total > 0 && r.out === r.total;
}
