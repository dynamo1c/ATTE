import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatDateLong, formatDateShort, todayIn } from "@/lib/domain/dates";
import { formatIndianMobile } from "@/lib/domain/phone";
import { DAY_PART, STAFF_LEAVE_TYPE, type StaffLeaveType } from "@/lib/domain/staff-leave";
import { requireStaff } from "@/server/current";
import { generateSessions } from "@/server/generate-sessions";
import { markableClassIds } from "@/server/attendance-data";
import { attentionFor, departmentOverview, staffOnLeaveToday } from "@/server/overview";
import { getCurrentTerm, getSettings } from "@/server/queries";

export const metadata = { title: "Dashboard · MEI Attendance" };

export default async function Dashboard() {
  const me = await requireStaff();
  const currentTerm = await getCurrentTerm();
  const today = todayIn();
  const db = getDb();
  // Today's classes must exist before counting/listing them (the nightly job may not have run).
  // Principal/admin counts cover the whole college, so every class must be generated, not only markable ones.
  const classIds = seesWholeCollege(me.actor) ? null : await markableClassIds(me.actor);
  await generateSessions(db, { classIds: classIds ?? undefined, until: today, reuse: true });

  // Which classes the counts cover: whole college, own department(s), or own class(es).
  const deptIds = visibleDepartmentIds(me.actor);
  const ownClassIds = [...new Set([...classTeacherClassIds(me.actor), ...me.actor.teachingClassIds])];
  const scope =
    deptIds === null
      ? sql`true`
      : deptIds.length > 0
        ? sql`cg.department_id IN (${sql.join(deptIds.map((d) => sql`${d}`), sql`, `)})`
        : ownClassIds.length > 0
          ? sql`cg.id IN (${sql.join(ownClassIds.map((c) => sql`${c}`), sql`, `)})`
          : sql`false`;
  const scopeLabel = seesWholeCollege(me.actor) ? "Whole college" : deptIds?.length ? "Your department" : "Your classes";

  const { rows: [counts] } = await db.execute<{ classes: number; students: number; pending: number; held_week: number }>(sql`
    WITH cls AS (SELECT cg.id FROM class_group cg WHERE cg.term_id = ${currentTerm?.id ?? -1} AND ${scope})
    SELECT
      (SELECT count(*)::int FROM cls) AS classes,
      (SELECT count(*)::int FROM class_membership m JOIN student s ON s.id = m.student_id
         WHERE m.class_group_id IN (SELECT id FROM cls) AND s.status = 'ACTIVE' AND m.left_on IS NULL) AS students,
      (SELECT count(*)::int FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id
         WHERE o.class_group_id IN (SELECT id FROM cls) AND cs.status = 'SCHEDULED' AND cs.date <= ${today}) AS pending,
      (SELECT count(*)::int FROM class_session cs JOIN course_offering o ON o.id = cs.offering_id
         WHERE o.class_group_id IN (SELECT id FROM cls) AND cs.status = 'HELD' AND cs.date > ${today}::date - 7) AS held_week
  `);

  const { rows: myToday } = await db.execute<{
    id: number;
    short_name: string;
    component: string;
    batch_scope: string;
    start_period: number;
    end_period: number;
    status: string;
    dept: string;
    semester: number;
    starts_at: string;
  }>(sql`
    SELECT cs.id, c.short_name, cs.component, cs.batch_scope, cs.start_period, cs.end_period, cs.status,
           d.code AS dept, cg.semester, to_char(p.starts_at, 'HH24:MI') AS starts_at
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    JOIN period p ON p.ordinal = cs.start_period
    WHERE cs.date = ${today}
      AND EXISTS (SELECT 1 FROM teaching_assignment ta WHERE ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.staff_id = ${me.id})
    ORDER BY cs.start_period
  `);

  const teaches = me.actor.teachingClassIds.length > 0 || me.actor.grants.some((g) => g.role === "FACULTY");
  const [attention, onLeave, departments, settings] = await Promise.all([
    attentionFor(me.actor, currentTerm?.id ?? null),
    staffOnLeaveToday(me.actor, today),
    seesWholeCollege(me.actor) && currentTerm ? getSettings().then((st) => departmentOverview(currentTerm.id, today, st.attendanceMinPct)) : Promise.resolve([]),
    getSettings(),
  ]);

  return (
    <>
      <PageHeader
        title={`Hello, ${me.name.split(" ")[0]}`}
        subtitle={`${formatDateLong(today)} · ${scopeLabel}`}
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Classes" value={counts.classes} />
        <Stat label="Active students" value={counts.students.toLocaleString("en-IN")} />
        <Stat label="Attendance not yet entered" value={counts.pending} hint="Past or today's classes still unmarked" />
        <Stat label="Classes held (last 7 days)" value={counts.held_week.toLocaleString("en-IN")} />
      </dl>

      <Card title="Needs your attention" className="mt-6">
        {attention.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing waiting for you.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {attention.map((x) => (
              <li key={x.href + x.label}>
                <Link href={x.href} className="flex items-center justify-between gap-3 py-2 text-sm text-slate-800 hover:text-blue-800">
                  <span>{x.label}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone="amber">{x.count}</Badge>
                    <span aria-hidden className="text-slate-400">→</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {onLeave.length > 0 && (
        <Card title={`Staff on leave today (${onLeave.length})`} className="mt-6">
          <ul className="space-y-1 text-sm">
            {onLeave.map((l, i) => (
              <li key={i} className="flex flex-wrap gap-x-2">
                <span className="font-medium text-slate-900">{l.name}</span>
                <span className="text-slate-500">
                  {l.dept ?? "Office"} · {STAFF_LEAVE_TYPE[l.type as StaffLeaveType]}
                  {l.part !== "FULL" ? ` · ${DAY_PART[l.part].toLowerCase()}` : l.to_date !== today ? ` · until ${formatDateShort(l.to_date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          <Link href="/staff-leave" className="mt-3 inline-block text-sm text-blue-700 hover:underline">
            Classes needing a substitute →
          </Link>
        </Card>
      )}

      {departments.length > 0 && (
        <Card title="Departments" className="mt-6">
          <Table>
            <thead>
              <tr>
                <Th>Department</Th>
                <Th>HOD</Th>
                <Th className="text-right">Students</Th>
                <Th className="text-right">Attendance</Th>
                <Th className="text-right">Below {settings.attendanceMinPct}%</Th>
                <Th className="text-right">Not entered</Th>
                <Th className="text-right">Marks to publish</Th>
                <Th className="text-right">Staff leave</Th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => (
                <tr key={d.id}>
                  <Td>
                    <Link href="/classes" className="font-medium text-blue-700 hover:underline">
                      {d.code}
                    </Link>
                    <div className="max-w-48 truncate text-xs text-slate-500">{d.name}</div>
                  </Td>
                  <Td>
                    {d.hodName ?? <span className="text-slate-400">No HOD</span>}
                    {d.hodPhone && (
                      <div className="flex gap-2 text-xs">
                        <a href={`tel:${d.hodPhone}`} className="text-blue-700 hover:underline">
                          {formatIndianMobile(d.hodPhone)}
                        </a>
                        <a href={`https://wa.me/${d.hodPhone.replace("+", "")}`} target="_blank" rel="noreferrer" className="text-green-700 hover:underline">
                          WhatsApp
                        </a>
                      </div>
                    )}
                  </Td>
                  <Td className="text-right tabular-nums">{d.students.toLocaleString("en-IN")}</Td>
                  <Td className="text-right tabular-nums">{d.attendancePct === null ? "—" : `${d.attendancePct.toFixed(1)}%`}</Td>
                  <Td className="text-right tabular-nums">{d.belowMin ? <Badge tone="red">{d.belowMin}</Badge> : 0}</Td>
                  <Td className="text-right tabular-nums">{d.notEntered ? <Badge tone="amber">{d.notEntered}</Badge> : 0}</Td>
                  <Td className="text-right tabular-nums">{d.marksWaiting}</Td>
                  <Td className="text-right tabular-nums">
                    {d.staffOnLeaveToday ? `${d.staffOnLeaveToday} today` : "—"}
                    {d.staffLeavePending ? <div className="text-xs text-amber-700">{d.staffLeavePending} waiting</div> : null}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Attendance: present or late out of classes marked this term, before leave rules. &quot;Below&quot; counts students overall, not per subject.</p>
        </Card>
      )}

      {teaches && (
      <Card title="Your classes today" className="mt-6">
        {myToday.length === 0 ? (
          <Empty>No classes for you today.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>Class</Th>
                <Th>Subject</Th>
                <Th>Batch</Th>
                <Th>Attendance</Th>
              </tr>
            </thead>
            <tbody>
              {myToday.map((s) => (
                <tr key={s.id}>
                  <Td className="tabular-nums">{s.starts_at}</Td>
                  <Td>
                    {s.dept} Sem {s.semester}
                  </Td>
                  <Td>
                    {s.short_name} {s.component === "PRACTICAL" && <Badge tone="violet">Lab</Badge>}
                  </Td>
                  <Td>{s.batch_scope === "ALL" ? "Whole class" : s.batch_scope}</Td>
                  <Td>
                    <Link href={`/attendance/${s.id}`} className="hover:underline">
                      {s.status === "HELD" ? <Badge tone="green">Marked</Badge> : s.status === "SCHEDULED" ? <Badge tone="amber">Take attendance →</Badge> : <Badge>{s.status.replace("_", " ").toLowerCase()}</Badge>}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Link href="/attendance" className="mt-3 inline-block text-sm text-blue-700 hover:underline">All attendance →</Link>
      </Card>
      )}

      {!currentTerm && (
        <p className="mt-6 text-sm text-amber-800">
          No term is set up yet. <Link href="/admin/settings" className="underline">Open settings</Link>.
        </p>
      )}
    </>
  );
}
