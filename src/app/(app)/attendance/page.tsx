import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { DayTimetable } from "@/components/day-timetable";
import { Badge, Card, Empty, Input, PageHeader, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { coverDepartmentIds, hodDepartmentIds, isAdmin } from "@/lib/auth/permissions";
import { addDays, formatDateLong, formatDateShort, isIsoDate, todayIn } from "@/lib/domain/dates";
import { lockState } from "@/lib/domain/marking";
import { generateSessions } from "@/server/generate-sessions";
import { listSessions, markableClassIds } from "@/server/attendance-data";
import { requireStaff } from "@/server/current";
import { listPeriods } from "@/server/class-data";
import { departmentDay } from "@/server/department-day";
import { getCurrentTerm, getSettings, listClasses, listDepartments } from "@/server/queries";

export const metadata = { title: "Attendance · MEI Attendance" };

const VIEWS = { timetable: "Timetable", today: "My classes today", pending: "Not yet entered", date: "Pick a day" } as const;

/** Current time in college time as "HH:MM", to tell a class that is due from one that hasn't started. */
const nowHHMM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

export default async function AttendancePage(props: PageProps<"/attendance">) {
  const me = await requireStaff();
  const sp = await props.searchParams;
  const today = todayIn();
  // Faculty and HODs see their department's whole timetable first; staff with no department (common pool) their own classes.
  const cover = coverDepartmentIds(me.actor);
  const hasGrid = cover === null || cover.length > 0;
  const requested = typeof sp.view === "string" && sp.view in VIEWS ? (sp.view as keyof typeof VIEWS) : null;
  const view: keyof typeof VIEWS = requested === "timetable" && !hasGrid ? "today" : (requested ?? (hasGrid ? "timetable" : "today"));
  const canSeeDept = isAdmin(me.actor) || hodDepartmentIds(me.actor).length > 0;
  const scope = canSeeDept && sp.scope === "department" ? "department" : "mine";
  const day = isIsoDate(sp.day) && sp.day <= today ? sp.day : today;

  // Make sure today's (and any missed) sessions exist before listing them.
  const classIds = await markableClassIds(me.actor);
  await generateSessions(getDb(), { classIds: classIds ?? undefined, until: today, reuse: true });

  const settings = await getSettings();
  const range = view === "pending" ? { from: addDays(today, -45), to: today } : view === "date" ? { from: day, to: day } : { from: today, to: today };
  const rows = view === "timetable" ? [] : await listSessions(me.actor, { ...range, scope, onlyPending: view === "pending" });
  const grid = view === "timetable" ? await loadGrid(me.actor, me.id, day, typeof sp.dept === "string" ? sp.dept : undefined) : null;

  const { rows: [pendingRequests] } = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attendance_edit_request r
    JOIN class_session cs ON cs.id = r.session_id JOIN course_offering o ON o.id = cs.offering_id JOIN class_group cg ON cg.id = o.class_group_id
    WHERE r.status = 'PENDING' AND ${isAdmin(me.actor) ? sql`true` : hodDepartmentIds(me.actor).length ? sql`cg.department_id IN (${sql.join(hodDepartmentIds(me.actor).map((d) => sql`${d}`), sql`, `)})` : sql`r.requested_by = ${me.id}`}`);

  const link = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ view, scope, ...(view === "date" || view === "timetable" ? { day } : {}), ...(grid?.dept ? { dept: String(grid.dept.id) } : {}), ...patch });
    return `/attendance?${q}`;
  };

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle={`Teachers can change attendance for ${settings.attendanceLockDays} day${settings.attendanceLockDays === 1 ? "" : "s"} after a class; after that the HOD approves changes.`}
        actions={
          <Link href="/attendance/requests" className={buttonClass("secondary", "sm")}>
            Change requests {pendingRequests.n > 0 && <Badge tone="amber">{pendingRequests.n}</Badge>}
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).filter((v) => v !== "timetable" || hasGrid).map((v) => (
          <Link key={v} href={link({ view: v })} className={`rounded-md px-3 py-1.5 text-sm ${v === view ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            {VIEWS[v]}
          </Link>
        ))}
        {canSeeDept && view !== "timetable" && (
          <span className="ml-auto flex gap-1 text-sm">
            <Link href={link({ scope: "mine" })} className={scope === "mine" ? "font-semibold text-blue-800" : "text-slate-600 hover:underline"}>
              My classes
            </Link>
            <span className="text-slate-300">|</span>
            <Link href={link({ scope: "department" })} className={scope === "department" ? "font-semibold text-blue-800" : "text-slate-600 hover:underline"}>
              {isAdmin(me.actor) ? "All departments" : "Whole department"}
            </Link>
          </span>
        )}
      </div>

      {view === "date" && (
        <form method="get" className="mb-4 flex items-end gap-2">
          <input type="hidden" name="view" value="date" />
          <input type="hidden" name="scope" value={scope} />
          <Input type="date" name="day" defaultValue={day} max={today} className="max-w-44" />
          <button className={buttonClass("secondary")}>Show</button>
        </form>
      )}

      {grid && (
        <>
          <form method="get" className="mb-3 flex flex-wrap items-center gap-2">
            <input type="hidden" name="view" value="timetable" />
            {grid.departments.length > 1 && (
              <Select name="dept" defaultValue={grid.dept?.id} aria-label="Department" className="w-auto">
                {grid.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code}
                  </option>
                ))}
              </Select>
            )}
            <Link href={link({ day: addDays(day, -1) })} className={buttonClass("secondary", "sm")} aria-label="Previous day">
              ←
            </Link>
            <Input type="date" name="day" defaultValue={day} max={today} aria-label="Day" className="w-40" />
            <button className={buttonClass("secondary", "sm")}>Show</button>
            {day < today && (
              <Link href={link({ day: addDays(day, 1) })} className={buttonClass("secondary", "sm")} aria-label="Next day">
                →
              </Link>
            )}
            <span className="text-sm font-medium text-slate-800">
              {grid.dept?.code} · {day === today ? "Today, " : ""}
              {formatDateLong(day)}
            </span>
          </form>
          <p className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm border border-amber-400 bg-amber-50 align-middle" />
              Take: nobody has saved it yet (any teacher of the department can)
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm border border-green-300 bg-green-50 align-middle" />✓ saved, with who saved it
            </span>
            <span>
              <span className="mr-1 inline-block size-2.5 rounded-sm ring-1 ring-blue-400 align-middle" />
              Your subject
            </span>
          </p>
          {!grid.dept || grid.classes.length === 0 ? (
            <Card>
              <Empty>No classes in this department this term.</Empty>
            </Card>
          ) : grid.sessions.length === 0 ? (
            <Card>
              <Empty>No classes on this day (holiday, exam day or Sunday).</Empty>
            </Card>
          ) : (
            <DayTimetable classes={grid.classes} periods={grid.periods} sessions={grid.sessions} now={day === today ? nowHHMM() : "24:00"} lock={lockState(day, today, settings.attendanceLockDays)} viewerId={me.id} />
          )}
        </>
      )}

      {!grid && (
      <Card>
        {rows.length === 0 ? (
          <Empty>{view === "pending" ? "Nothing pending. Every class is entered. ✓" : view === "today" ? "No classes today." : "No classes on this day."}</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Time</Th>
                <Th>Class</Th>
                <Th>Subject</Th>
                <Th>Status</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const lock = lockState(r.date, today, settings.attendanceLockDays);
                return (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap">{r.date === today ? "Today" : formatDateShort(r.date)}</Td>
                    <Td className="tabular-nums">{r.starts_at}</Td>
                    <Td>{r.class_name}</Td>
                    <Td>
                      {r.subject}
                      {r.component === "PRACTICAL" && " Lab"}
                      {r.batch_scope !== "ALL" && <span className="ml-1 text-xs text-slate-500">{r.batch_scope}</span>}
                      {scope === "department" && !r.mine && <span className="ml-1 text-xs text-slate-400">(not yours)</span>}
                    </Td>
                    <Td>
                      {r.status === "HELD" ? (
                        <Badge tone="green">Entered</Badge>
                      ) : r.status === "SCHEDULED" ? (
                        lock === "LOCKED" ? <Badge tone="red">Late — needs HOD</Badge> : <Badge tone="amber">Pending</Badge>
                      ) : r.status === "NOT_HELD" ? (
                        <Badge>Not held</Badge>
                      ) : (
                        <Badge>Cancelled</Badge>
                      )}
                    </Td>
                    <Td>
                      <Link href={`/attendance/${r.id}`} className={buttonClass(r.status === "SCHEDULED" ? "primary" : "secondary", "sm")}>
                        {r.status === "SCHEDULED" ? "Take attendance" : "Open"}
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      )}
    </>
  );
}

/** The day grid for one department this person covers (the first one unless `deptParam` picks another). */
async function loadGrid(actor: Parameters<typeof coverDepartmentIds>[0], viewerId: number, day: string, deptParam: string | undefined) {
  const cover = coverDepartmentIds(actor);
  const term = await getCurrentTerm();
  const departments = (await listDepartments()).filter((d) => cover === null || cover.includes(d.id));
  const dept = departments.find((d) => String(d.id) === deptParam) ?? departments[0];
  if (!term || !dept) return { departments, dept: null, classes: [], periods: [], sessions: [] };
  const [classRows, periodRows] = await Promise.all([listClasses(term.id, { departmentIds: [dept.id] }), listPeriods()]);
  const sessions = await departmentDay(term.id, day, [dept.id], viewerId);
  return {
    departments,
    dept,
    classes: classRows.map((c) => ({ id: c.id, label: `Sem ${c.semester}`, classTeacher: c.classTeacher })),
    periods: periodRows.map((p) => ({ ordinal: p.ordinal, startsAt: p.startsAt.slice(0, 5), endsAt: p.endsAt.slice(0, 5) })),
    sessions,
  };
}

