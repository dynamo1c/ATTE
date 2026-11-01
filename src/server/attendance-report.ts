import "server-only";
import { cache } from "react";
import { getDb } from "@/db/client";
import type { IsoDate } from "@/lib/domain/dates";
import { loadClassAttendance, loadLeavePolicy, type ClassAttendance } from "./attendance-core";
import { getSettings } from "./queries";

export { isCurrent, type ClassAttendance, type StudentRow, type SubjectRef } from "./attendance-core";

/** Leave policy, read once per request. */
export const getLeavePolicy = cache(() => loadLeavePolicy(getDb()));

/**
 * Attendance for one class with the college's current thresholds and leave rules.
 * `to` defaults to today and is capped at today; `studentIds` limits the students; `detailFrom` adds each class's outcome.
 */
export async function getClassAttendance(classId: number, opts: { from?: IsoDate | null; to?: IsoDate | null; studentIds?: number[]; detailFrom?: IsoDate } = {}): Promise<ClassAttendance> {
  const [settings, policy] = await Promise.all([getSettings(), getLeavePolicy()]);
  return loadClassAttendance(getDb(), classId, { minPct: settings.attendanceMinPct, warnPct: settings.attendanceWarnPct, policy }, opts);
}
