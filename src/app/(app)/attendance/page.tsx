import Link from "next/link";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, Input, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui";
import { hodDepartmentIds, isAdmin } from "@/lib/auth/permissions";
import { addDays, formatDateShort, todayIn } from "@/lib/domain/dates";
import { lockState } from "@/lib/domain/marking";
import { generateSessions } from "@/server/generate-sessions";
import { listSessions, markableClassIds } from "@/server/attendance-data";
import { requireStaff } from "@/server/current";
import { getSettings } from "@/server/queries";

export const metadata = { title: "Attendance · MEI Attendance" };

const VIEWS = { today: "Today", pending: "Not yet entered", date: "Pick a day" } as const;

export default async function AttendancePage(props: PageProps<"/attendance">) {
  const me = await requireStaff();
  const sp = await props.searchParams;
  const today = todayIn();
  const view = (typeof sp.view === "string" && sp.view in VIEWS ? sp.view : "today") as keyof typeof VIEWS;
  const canSeeDept = isAdmin(me.actor) || hodDepartmentIds(me.actor).length > 0;
  const scope = canSeeDept && sp.scope === "department" ? "department" : "mine";
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) && sp.day <= today ? sp.day : today;

  // Make sure today's (and any missed) sessions exist before listing them.
  const classIds = await markableClassIds(me.actor);
  await generateSessions(getDb(), { classIds: classIds ?? undefined, until: today });

  const settings = await getSettings();
  const range = view === "pending" ? { from: addDays(today, -45), to: today } : view === "date" ? { from: day, to: day } : { from: today, to: today };
  const rows = await listSessions(me.actor, { ...range, scope, onlyPending: view === "pending" });

  const { rows: [pendingRequests] } = await getDb().execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM attendance_edit_request r
    JOIN class_session cs ON cs.id = r.session_id JOIN course_offering o ON o.id = cs.offering_id JOIN class_group cg ON cg.id = o.class_group_id
    WHERE r.status = 'PENDING' AND ${isAdmin(me.actor) ? sql`true` : hodDepartmentIds(me.actor).length ? sql`cg.department_id IN (${sql.join(hodDepartmentIds(me.actor).map((d) => sql`${d}`), sql`, `)})` : sql`r.requested_by = ${me.id}`}`);

  const link = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ view, scope, ...(view === "date" ? { day } : {}), ...patch });
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
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((v) => (
          <Link key={v} href={link({ view: v })} className={`rounded-md px-3 py-1.5 text-sm ${v === view ? "bg-blue-700 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
            {VIEWS[v]}
          </Link>
        ))}
        {canSeeDept && (
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
    </>
  );
}
