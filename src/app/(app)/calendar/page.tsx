import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Card, Input, PageHeader, Select, buttonClass } from "@/components/ui";
import { canEditCalendar, classTeacherClassIds, hodDepartmentIds, seesWholeCollege } from "@/lib/auth/permissions";
import { addDays, isoWeekday, todayIn, weekStart } from "@/lib/domain/dates";
import { WEEKDAYS } from "@/server/class-data";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses, listDepartments } from "@/server/queries";
import { addCalendarDay, deleteCalendarDay } from "./actions";

export const metadata = { title: "Calendar · MEI Attendance" };

const TYPE_STYLE = {
  HOLIDAY: "bg-red-50 text-red-800 border-red-200",
  EXAM: "bg-amber-50 text-amber-900 border-amber-200",
  EVENT: "bg-blue-50 text-blue-800 border-blue-200",
  WORKING: "bg-green-50 text-green-800 border-green-200",
} as const;
const TYPE_LABEL = { HOLIDAY: "Holiday", EXAM: "Exam", EVENT: "Event (classes run)", WORKING: "Working day" } as const;

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const me = await requireStaff();
  const today = todayIn();
  const mParam = (await props.searchParams).m;
  const month = typeof mParam === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(mParam) ? mParam : today.slice(0, 7);
  const first = `${month}-01`;
  const nextMonth = addDays(first, 32).slice(0, 7);
  const prevMonth = addDays(first, -1).slice(0, 7);
  const gridStart = weekStart(first);
  const lastDay = addDays(`${nextMonth}-01`, -1);
  const gridEnd = addDays(lastDay, 7 - isoWeekday(lastDay));

  const term = await getCurrentTerm();
  const [departments, classes] = await Promise.all([listDepartments(), term ? listClasses(term.id) : Promise.resolve([])]);
  const { rows: entries } = await getDb().execute<{ id: number; date: string; type: keyof typeof TYPE_STYLE; follows_weekday: number | null; note: string | null; dept: string | null; class_label: string | null; department_id: number | null; class_group_id: number | null; class_dept_id: number | null }>(sql`
    SELECT cd.id, to_char(cd.date, 'YYYY-MM-DD') AS date, cd.type, cd.follows_weekday, cd.note, d.code AS dept,
           cdd.code || ' Sem ' || cg.semester AS class_label, cd.department_id, cd.class_group_id, cg.department_id AS class_dept_id
    FROM calendar_day cd
    LEFT JOIN department d ON d.id = cd.department_id
    LEFT JOIN class_group cg ON cg.id = cd.class_group_id
    LEFT JOIN department cdd ON cdd.id = cg.department_id
    WHERE cd.date BETWEEN ${gridStart} AND ${gridEnd}
    ORDER BY cd.date, cd.department_id NULLS FIRST, cd.class_group_id NULLS FIRST`);

  // Scopes this person may add to.
  const hodDepts = hodDepartmentIds(me.actor);
  const scopeOptions: { value: string; label: string }[] = [];
  if (canEditCalendar(me.actor, { kind: "COLLEGE" })) scopeOptions.push({ value: "college", label: "Whole college" });
  for (const d of departments) if (canEditCalendar(me.actor, { kind: "DEPARTMENT", departmentId: d.id })) scopeOptions.push({ value: `dept:${d.id}`, label: `${d.code} department` });
  for (const c of classes) if (canEditCalendar(me.actor, { kind: "CLASS", classRef: c })) scopeOptions.push({ value: `class:${c.id}`, label: `${c.departmentCode} Sem ${c.semester} only` });

  const relevant = (e: (typeof entries)[number]) =>
    seesWholeCollege(me.actor) ||
    (e.department_id === null && e.class_group_id === null) ||
    (e.department_id !== null && (hodDepts.includes(e.department_id) || me.departmentId === e.department_id)) ||
    (e.class_group_id !== null && (hodDepts.includes(e.class_dept_id!) || classTeacherClassIds(me.actor).includes(e.class_group_id) || me.actor.teachingClassIds.includes(e.class_group_id)));
  const byDate = new Map<string, typeof entries>();
  for (const e of entries.filter(relevant)) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);

  const canDelete = canEditCalendar(me.actor);

  const days: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);
  const monthLabel = new Date(`${first}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

  return (
    <>
      <PageHeader
        title="Calendar"
        subtitle={`Holidays and exam days stop regular classes. Days not listed follow the normal week (Sunday off).${canDelete ? "" : " Kept by the college office."}`}
        actions={
          <div className="flex items-center gap-2">
            <Link href={`/calendar?m=${prevMonth}`} className={buttonClass("secondary", "sm")}>
              ←
            </Link>
            <span className="min-w-36 text-center text-sm font-medium">{monthLabel}</span>
            <Link href={`/calendar?m=${nextMonth}`} className={buttonClass("secondary", "sm")}>
              →
            </Link>
            {month !== today.slice(0, 7) && (
              <Link href="/calendar" className={buttonClass("ghost", "sm")}>
                Today
              </Link>
            )}
          </div>
        }
      />

      <Card>
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 text-sm">
          {WEEKDAYS.slice(1).map((w) => (
            <div key={w} className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">
              {w}
            </div>
          ))}
          {days.map((d) => {
            const inMonth = d.startsWith(month);
            const sunday = isoWeekday(d) === 7;
            return (
              <div key={d} className={`min-h-24 bg-white p-1.5 ${inMonth ? "" : "opacity-40"} ${sunday ? "bg-slate-50" : ""}`}>
                <div className={`mb-1 text-xs ${d === today ? "inline-block rounded-full bg-blue-700 px-1.5 font-semibold text-white" : "text-slate-500"}`}>{Number(d.slice(8))}</div>
                <div className="space-y-1">
                  {(byDate.get(d) ?? []).map((e) => (
                    <div key={e.id} className={`group rounded border px-1 py-0.5 text-[11px] leading-tight ${TYPE_STYLE[e.type]}`}>
                      <div className="flex items-start justify-between gap-1">
                        <span>
                          {e.note ?? TYPE_LABEL[e.type]}
                          {e.follows_weekday && ` (${WEEKDAYS[e.follows_weekday]} timetable)`}
                        </span>
                        {canDelete && (
                          <ActionForm action={deleteCalendarDay} confirm={`Remove “${e.note ?? TYPE_LABEL[e.type]}” on ${d}?`}>
                            <input type="hidden" name="id" value={e.id} />
                            <button type="submit" aria-label="Remove" className="px-0.5 opacity-50 hover:opacity-100">
                              ×
                            </button>
                          </ActionForm>
                        )}
                      </div>
                      {(e.dept || e.class_label) && <div className="opacity-75">{e.dept ? `${e.dept} only` : `${e.class_label} only`}</div>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {scopeOptions.length > 0 && (
        <Card title="Add to calendar" className="mt-6 max-w-4xl">
          <ActionForm action={addCalendarDay} resetOnSuccess className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date" name="date">
                <Input id="date" name="date" type="date" defaultValue={today} />
              </Field>
              <Field label="Type" name="type">
                <Select id="type" name="type">
                  {Object.entries(TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Applies to" name="scope">
                <Select id="scope" name="scope">
                  {scopeOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Note" name="note" className="sm:col-span-2">
                <Input id="note" name="note" placeholder="Deepavali / CIE-2 / Sports day" />
              </Field>
              <Field label="Follow timetable of" name="followsWeekday" hint="Working days only, e.g. Saturday runs Monday's classes.">
                <Select id="followsWeekday" name="followsWeekday">
                  <option value="">Its own day</option>
                  {[1, 2, 3, 4, 5, 6].map((d) => (
                    <option key={d} value={d}>
                      {WEEKDAYS[d]}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="cancelClasses" className="size-4" /> Cancel classes already recorded on that day (needed if attendance was taken)
            </label>
            <SubmitButton>Add</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
