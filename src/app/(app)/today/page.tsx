import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, Input, NoAccess, PageHeader, Select, buttonClass } from "@/components/ui";
import { canMarkSession, coverDepartmentIds } from "@/lib/auth/permissions";
import { addDays, formatDateLong, isIsoDate, todayIn } from "@/lib/domain/dates";
import { lockState } from "@/lib/domain/marking";
import { departmentDay, type DayPeriod } from "@/server/department-day";
import { requireStaff } from "@/server/current";
import { generateSessions } from "@/server/generate-sessions";
import { getCurrentTerm, getSettings, listClasses, listDepartments } from "@/server/queries";

export const metadata = { title: "Department today · MEI Attendance" };

/** Current time in college time as "HH:MM", to tell "not taken yet" from "coming up". */
function nowHHMM() {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * Every class of the department on one page, period by period: who teaches it, and whether attendance is
 * taken and by whom. Any faculty of the department can open a class nobody has taken yet (substitute).
 */
export default async function DepartmentTodayPage(props: PageProps<"/today">) {
  const me = await requireStaff();
  const cover = coverDepartmentIds(me.actor);
  if (cover !== null && cover.length === 0) return <NoAccess what="the department timetable" />;
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="the department timetable (no term set up)" />;

  const sp = await props.searchParams;
  const today = todayIn();
  const settings = await getSettings();
  const oldest = addDays(today, -settings.attendanceLockDays);
  const day = isIsoDate(sp.day) && sp.day <= today && sp.day >= oldest ? sp.day : today;

  // Departments this person covers; the admin (and an HOD of several) picks one at a time.
  const departments = (await listDepartments()).filter((d) => cover === null || cover.includes(d.id));
  const deptId = departments.find((d) => String(d.id) === sp.dept)?.id ?? departments[0]?.id;
  if (deptId === undefined) return <NoAccess what="the department timetable" />;
  const dept = departments.find((d) => d.id === deptId)!;

  const classes = await listClasses(term.id, { departmentIds: [deptId] });
  await generateSessions(getDb(), { classIds: classes.map((c) => c.id), until: today, reuse: true });
  const periods = await departmentDay(term.id, day, [deptId], me.id);
  const byClass = new Map<number, DayPeriod[]>(classes.map((c) => [c.id, []]));
  for (const p of periods) byClass.get(p.classId)?.push(p);

  const lock = lockState(day, today, settings.attendanceLockDays);
  const now = day === today ? nowHHMM() : "24:00";
  const open = periods.filter((p) => p.status === "SCHEDULED" && p.startsAt <= now).length;
  const link = (patch: Record<string, string>) => `/today?${new URLSearchParams({ day, dept: String(deptId), ...patch })}`;

  return (
    <>
      <PageHeader
        title={`${dept.code} · ${day === today ? "Today" : formatDateLong(day)}`}
        subtitle="Every class of the department, period by period. Tap a class nobody has taken to take attendance (e.g. as a substitute). A saved class stays with the person who saved it, the subject teacher and the HOD."
      />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        {departments.length > 1 && (
          <Select name="dept" defaultValue={deptId} aria-label="Department" className="w-auto">
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.code} — {d.name}
              </option>
            ))}
          </Select>
        )}
        <Input type="date" name="day" defaultValue={day} min={oldest} max={today} aria-label="Day" className="w-44" />
        <button className={buttonClass("secondary")}>Show</button>
        {day !== today && (
          <Link href={link({ day: today })} className="text-sm text-blue-700 hover:underline">
            Back to today
          </Link>
        )}
        <span className="ml-auto text-sm text-slate-600">{periods.length === 0 ? "" : open ? <Badge tone="amber">{open} not taken yet</Badge> : <Badge tone="green">All taken so far</Badge>}</span>
      </form>

      {classes.length === 0 ? (
        <Empty>No classes in this department this term.</Empty>
      ) : (
        <div className="space-y-4">
          {classes.map((c) => {
            const list = byClass.get(c.id) ?? [];
            return (
              <Card key={c.id} title={`${dept.code} Sem ${c.semester}`} actions={c.classTeacher ? <span className="text-xs text-slate-500">Class teacher: {c.classTeacher}</span> : undefined}>
                {list.length === 0 ? (
                  <Empty>No classes this day (holiday, exam or weekend).</Empty>
                ) : (
                  <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    {list.map((p) => (
                      <li key={p.id}>
                        <PeriodChip p={p} now={now} lock={lock} canOpen={canMarkSession(me.actor, { classRef: { id: c.id, departmentId: deptId }, assignedStaffIds: p.mine ? [me.id] : [], markedBy: p.savedById })} />
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function PeriodChip({ p, now, lock, canOpen }: { p: DayPeriod; now: string; lock: ReturnType<typeof lockState>; canOpen: boolean }) {
  const upcoming = p.status === "SCHEDULED" && p.startsAt > now;
  const status =
    p.status === "HELD" ? (
      <Badge tone="green">
        Saved by {p.savedBy} · {p.savedAt}
      </Badge>
    ) : p.status === "NOT_HELD" ? (
      <Badge>Not held{p.statusReason ? `: ${p.statusReason}` : ""}</Badge>
    ) : p.status === "CANCELLED" ? (
      <Badge>Cancelled</Badge>
    ) : upcoming ? (
      <Badge tone="blue">Coming up</Badge>
    ) : lock === "LOCKED" ? (
      <Badge tone="red">Not taken — needs HOD</Badge>
    ) : (
      <Badge tone="amber">Not taken</Badge>
    );
  const tone = p.status === "HELD" ? "border-green-200 bg-green-50/50" : p.status === "SCHEDULED" && !upcoming ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white";
  const body = (
    <div className={`h-full rounded-lg border px-3 py-2 text-sm ${tone} ${canOpen && !upcoming ? "hover:border-blue-400" : ""}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-slate-900">
          {p.subject}
          {p.component === "PRACTICAL" && " Lab"}
          {p.batchScope !== "ALL" && <span className="ml-1 text-xs text-slate-500">{p.batchScope}</span>}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500">
          {p.startsAt}–{p.endsAt}
        </span>
      </div>
      <div className="truncate text-xs text-slate-600">
        {p.teachers ?? "No teacher assigned"}
        {p.mine && <span className="ml-1 font-medium text-blue-700">(you)</span>}
      </div>
      <div className="mt-1">{status}</div>
    </div>
  );
  // A class that hasn't started yet can't be taken; one saved by someone else opens read-only ("saved by …").
  return upcoming ? body : (
    <Link href={`/attendance/${p.id}`} className="block h-full" aria-label={`${p.subject} ${p.startsAt}${canOpen ? "" : " (view)"}`}>
      {body}
    </Link>
  );
}
