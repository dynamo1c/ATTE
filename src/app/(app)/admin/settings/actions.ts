"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { collegeSettings, leavePolicy, notificationSetting } from "@/db/schema";
import { canManageSettings } from "@/lib/auth/permissions";
import { checkbox, decimal, int, oneOf, text } from "@/lib/forms";
import { CONFIGURABLE_TRIGGERS } from "@/lib/notify/rules";
import { formAction, UserError } from "@/server/action";
import { audit } from "@/server/audit";
import { ensure } from "@/server/current";

const settingsSchema = z.object({
  name: text("College name"),
  attendanceMinPct: decimal("Minimum attendance", 0, 100),
  attendanceWarnPct: decimal("Warning level", 0, 100),
  attendanceLockDays: int("Edit window").refine((n) => n >= 0 && n <= 60, "Must be 0–60 days"),
  consecutiveAbsenceDays: int("Consecutive absence alert").refine((n) => n >= 0 && n <= 30, "Must be 0–30 days"),
  lowMarksPct: decimal("Low marks level", 0, 100),
  trackActivityPeriods: checkbox(),
});

export const saveSettings = formAction(settingsSchema, async (input, { me }) => {
  ensure(canManageSettings(me.actor));
  if (input.attendanceWarnPct < input.attendanceMinPct) {
    throw new UserError("Warning level must be at or above the minimum.", { attendanceWarnPct: ["Must be ≥ minimum attendance"] });
  }
  await getDb().transaction(async (tx) => {
    const [before] = await tx.select().from(collegeSettings).where(eq(collegeSettings.id, 1));
    await tx.update(collegeSettings).set({ ...input, updatedAt: new Date() }).where(eq(collegeSettings.id, 1));
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "college_settings", entityId: 1, before, after: input });
  });
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
});

const COUNTS = ["PRESENT", "EXCUSED", "ABSENT"] as const;
const leaveSchema = z.object({
  MEDICAL: oneOf(COUNTS, "Medical"),
  ON_DUTY: oneOf(COUNTS, "On duty"),
  PERSONAL: oneOf(COUNTS, "Personal"),
  OTHER: oneOf(COUNTS, "Other"),
});

export const saveLeavePolicy = formAction(leaveSchema, async (input, { me }) => {
  ensure(canManageSettings(me.actor));
  await getDb().transaction(async (tx) => {
    const before = await tx.select().from(leavePolicy);
    for (const [type, countsAs] of Object.entries(input)) {
      await tx
        .insert(leavePolicy)
        .values({ type: type as keyof typeof input, countsAs })
        .onConflictDoUpdate({ target: leavePolicy.type, set: { countsAs } });
    }
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "leave_policy", entityId: "all", before, after: input });
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Leave rules saved. Attendance percentages use them from now on." };
});

const messageSchema = z.object(Object.fromEntries(CONFIGURABLE_TRIGGERS.map((t) => [t, checkbox()])) as Record<(typeof CONFIGURABLE_TRIGGERS)[number], ReturnType<typeof checkbox>>);

export const saveMessageSettings = formAction(messageSchema, async (input, { me }) => {
  ensure(canManageSettings(me.actor));
  await getDb().transaction(async (tx) => {
    const before = await tx.select().from(notificationSetting);
    for (const trigger of CONFIGURABLE_TRIGGERS) {
      await tx
        .insert(notificationSetting)
        .values({ trigger, enabled: input[trigger] })
        .onConflictDoUpdate({ target: notificationSetting.trigger, set: { enabled: input[trigger], updatedAt: new Date() } });
    }
    await audit(tx, { actorStaffId: me.id, action: "UPDATE", entity: "notification_setting", entityId: "all", before, after: input });
  });
  revalidatePath("/admin/settings");
  return { ok: true, message: "Parent message settings saved." };
});
