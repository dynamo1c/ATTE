import { getDb } from "@/db/client";
import { collegeSettings, leavePolicy } from "@/db/schema";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Card, Input, NoAccess, PageHeader, Select } from "@/components/ui";
import { canManageSettings, seesWholeCollege } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { saveLeavePolicy, saveSettings } from "./actions";

export const metadata = { title: "Settings · MEI Attendance" };

const LEAVE_LABEL = { MEDICAL: "Medical leave", ON_DUTY: "On duty (sports, NSS, events)", PERSONAL: "Personal leave", OTHER: "Other" } as const;
const COUNTS_LABEL = { PRESENT: "Counts as present", EXCUSED: "Excused (not counted at all)", ABSENT: "Still absent (noted as leave)" } as const;

export default async function SettingsPage() {
  const me = await requireStaff();
  if (!seesWholeCollege(me.actor)) return <NoAccess what="settings" />;
  const canEdit = canManageSettings(me.actor);
  const db = getDb();
  const [[s], policies] = await Promise.all([db.select().from(collegeSettings), db.select().from(leavePolicy)]);
  const policy = Object.fromEntries(policies.map((p) => [p.type, p.countsAs]));

  return (
    <>
      <PageHeader title="Settings" subtitle={canEdit ? "College-wide rules. Every change is recorded." : "View only — only the admin can change these."} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Attendance & marks rules">
          <ActionForm action={saveSettings} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <Field label="College name" name="name">
                <Input id="name" name="name" defaultValue={s.name} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Minimum attendance for exams (%)" name="attendanceMinPct">
                  <Input id="attendanceMinPct" name="attendanceMinPct" inputMode="decimal" defaultValue={s.attendanceMinPct} />
                </Field>
                <Field label="&quot;At risk&quot; warning below (%)" name="attendanceWarnPct">
                  <Input id="attendanceWarnPct" name="attendanceWarnPct" inputMode="decimal" defaultValue={s.attendanceWarnPct} />
                </Field>
                <Field label="Teachers can edit attendance for (days)" name="attendanceLockDays" hint="After this, HOD approval is needed.">
                  <Input id="attendanceLockDays" name="attendanceLockDays" inputMode="numeric" defaultValue={s.attendanceLockDays} />
                </Field>
                <Field label="Alert parents after absent days in a row" name="consecutiveAbsenceDays" hint="0 turns this alert off.">
                  <Input id="consecutiveAbsenceDays" name="consecutiveAbsenceDays" inputMode="numeric" defaultValue={s.consecutiveAbsenceDays} />
                </Field>
                <Field label="Low marks alert below (% of max)" name="lowMarksPct">
                  <Input id="lowMarksPct" name="lowMarksPct" inputMode="decimal" defaultValue={s.lowMarksPct} />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="trackActivityPeriods" defaultChecked={s.trackActivityPeriods} className="size-4" />
                Take attendance in activity periods
              </label>
            </fieldset>
            {canEdit && <SubmitButton>Save rules</SubmitButton>}
          </ActionForm>
        </Card>

        <Card title="How leave affects attendance %">
          <p className="mb-4 text-sm text-slate-600">Applies when a student marked absent has an approved leave or on-duty notice for that day.</p>
          <ActionForm action={saveLeavePolicy} className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              {(Object.keys(LEAVE_LABEL) as (keyof typeof LEAVE_LABEL)[]).map((type) => (
                <Field key={type} label={LEAVE_LABEL[type]} name={type}>
                  <Select id={type} name={type} defaultValue={policy[type] ?? "ABSENT"}>
                    {Object.entries(COUNTS_LABEL).map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            </fieldset>
            {canEdit && <SubmitButton>Save leave rules</SubmitButton>}
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
