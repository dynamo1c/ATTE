import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatDateLong, todayIn } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { generateSessions } from "@/server/generate-sessions";
import { markableClassIds } from "@/server/attendance-data";
import { getCurrentTerm } from "@/server/queries";

export const metadata = { title: "Dashboard · MEI Attendance" };

export default async function Dashboard() {
  const me = await requireStaff();
  const currentTerm = await getCurrentTerm();
  const today = todayIn();
  const db = getDb();
  // Today's classes must exist before counting/listing them (the nightly job may not have run).
  // Principal/admin counts cover the whole college, so every class must be generated, not only markable ones.
  const classIds = seesWholeCollege(me.actor) ? null : await markableClassIds(me.actor);
  await generateSessions(db, { classIds: classIds ?? undefined, until: today });

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

      {!currentTerm && (
        <p className="mt-6 text-sm text-amber-800">
          No term is set up yet. <Link href="/admin/settings" className="underline">Open settings</Link>.
        </p>
      )}
    </>
  );
}
