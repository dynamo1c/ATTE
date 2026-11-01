import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, NoAccess, PageHeader, Stat, Table, Td, Th } from "@/components/ui";
import { canViewCompliance, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatDateShort, todayIn } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { generateSessions } from "@/server/generate-sessions";
import { getCurrentTerm, listVisibleClasses } from "@/server/queries";
import { ReportTabs } from "../tabs";

export const metadata = { title: "Not yet entered · MEI Attendance" };

const LIMIT = 3000;

type Row = {
  session_id: number;
  date: string;
  starts_at: string;
  subject: string;
  component: string;
  batch_scope: string;
  class_name: string;
  staff_id: number | null;
  staff_name: string | null;
  staff_dept: string | null;
};

export default async function ComplianceReport() {
  const me = await requireStaff();
  if (!canViewCompliance(me.actor)) return <NoAccess what="this report" />;
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="reports (no term set up)" />;
  const today = todayIn();
  const classes = await listVisibleClasses(me.actor, term.id);
  if (classes.length === 0) return <NoAccess what="this report" />;
  // Counts are only complete if every class up to today exists (the nightly job may not have run).
  await generateSessions(getDb(), { classIds: visibleDepartmentIds(me.actor) === null ? undefined : classes.map((c) => c.id), until: today });

  const { rows } = await getDb().execute<Row>(sql`
    SELECT cs.id AS session_id, to_char(cs.date, 'YYYY-MM-DD') AS date, to_char(p.starts_at, 'HH24:MI') AS starts_at,
           c.short_name AS subject, cs.component::text, cs.batch_scope::text, d.code || ' Sem ' || cg.semester AS class_name,
           st.id AS staff_id, st.name AS staff_name, sd.code AS staff_dept
    FROM class_session cs
    JOIN course_offering o ON o.id = cs.offering_id
    JOIN course c ON c.id = o.course_id
    JOIN class_group cg ON cg.id = o.class_group_id
    JOIN department d ON d.id = cg.department_id
    JOIN period p ON p.ordinal = cs.start_period
    LEFT JOIN teaching_assignment ta ON ta.offering_id = cs.offering_id AND ta.component = cs.component AND ta.batch_scope IN ('ALL', cs.batch_scope)
    LEFT JOIN staff st ON st.id = ta.staff_id
    LEFT JOIN department sd ON sd.id = st.department_id
    WHERE cs.status = 'SCHEDULED' AND cs.date <= ${today}::date
      AND cg.id IN (${sql.join(classes.map((c) => sql`${c.id}`), sql`, `)})
    ORDER BY cs.date, cs.start_period
    LIMIT ${LIMIT}`);

  // One session can have two teachers (e.g. shared lab); it appears under each, but the totals count it once.
  const byTeacher = new Map<string, { id: number | null; name: string; dept: string | null; overdue: Row[]; today: Row[] }>();
  const overdueIds = new Set<number>();
  const todayIds = new Set<number>();
  for (const r of rows) {
    const key = r.staff_id === null ? "none" : String(r.staff_id);
    let t = byTeacher.get(key);
    if (!t) byTeacher.set(key, (t = { id: r.staff_id, name: r.staff_name ?? "No teacher assigned", dept: r.staff_dept, overdue: [], today: [] }));
    if (r.date < today) {
      t.overdue.push(r);
      overdueIds.add(r.session_id);
    } else {
      t.today.push(r);
      todayIds.add(r.session_id);
    }
  }
  const teachers = [...byTeacher.values()].sort((a, b) => b.overdue.length - a.overdue.length || b.today.length - a.today.length || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader title="Reports" subtitle="Classes whose attendance has not been entered. They are left out of every percentage until entered, so parents and shortage lists depend on this being empty." />
      <ReportTabs active="compliance" showCompliance />

      <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Overdue (before today)" value={overdueIds.size} />
        <Stat label="Today, not yet entered" value={todayIds.size} hint="May still be in progress" />
        <Stat label="Teachers with overdue classes" value={teachers.filter((t) => t.overdue.length > 0).length} />
      </dl>
      {rows.length === LIMIT && <p className="mb-4 text-sm text-amber-800">Showing the oldest {LIMIT} only.</p>}

      <Card title="By teacher">
        {teachers.length === 0 ? (
          <Empty>Every class is entered. ✓</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Teacher</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Today</Th>
                <Th>Oldest</Th>
                <Th>Classes</Th>
              </tr>
            </thead>
            <tbody>
              {teachers.map((t) => {
                const list = [...t.overdue, ...t.today];
                return (
                  <tr key={t.id ?? "none"}>
                    <Td>
                      {t.id ? (
                        <Link href={`/staff/${t.id}`} className="text-blue-700 hover:underline">
                          {t.name}
                        </Link>
                      ) : (
                        <Badge tone="red">{t.name}</Badge>
                      )}
                      {t.dept && <div className="text-xs text-slate-500">{t.dept}</div>}
                    </Td>
                    <Td className={`text-right tabular-nums ${t.overdue.length ? "font-semibold text-red-800" : "text-slate-400"}`}>{t.overdue.length}</Td>
                    <Td className="text-right tabular-nums">{t.today.length}</Td>
                    <Td className="whitespace-nowrap">{list[0].date === today ? "Today" : formatDateShort(list[0].date)}</Td>
                    <Td>
                      <details>
                        <summary className="cursor-pointer text-sm text-blue-700">Show {list.length}</summary>
                        <ul className="mt-2 space-y-1 text-sm">
                          {list.slice(0, 60).map((r) => (
                            <li key={r.session_id}>
                              <Link href={`/attendance/${r.session_id}`} className="hover:underline">
                                <span className="text-slate-500">{r.date === today ? "Today" : formatDateShort(r.date)} {r.starts_at}</span> · {r.class_name} · {r.subject}
                                {r.component === "PRACTICAL" && " lab"}
                                {r.batch_scope !== "ALL" && ` ${r.batch_scope}`}
                              </Link>
                            </li>
                          ))}
                          {list.length > 60 && <li className="text-slate-500">…and {list.length - 60} more</li>}
                        </ul>
                      </details>
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
