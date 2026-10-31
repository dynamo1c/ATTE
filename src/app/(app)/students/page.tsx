import { sql } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { Badge, Card, Empty, Input, NoAccess, PageHeader, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses } from "@/server/queries";

export const metadata = { title: "Students · MEI Attendance" };
const LIMIT = 200;

export default async function StudentsPage(props: PageProps<"/students">) {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="students (no term set up yet)" />;
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";

  // Classes this person may see.
  const all = await listClasses(term.id);
  const depts = visibleDepartmentIds(me.actor);
  const own = new Set([...classTeacherClassIds(me.actor), ...me.actor.teachingClassIds]);
  const classes = seesWholeCollege(me.actor) ? all : all.filter((c) => depts?.includes(c.departmentId) || own.has(c.id));
  if (classes.length === 0) return <NoAccess what="any students" />;
  const selectedClass = classes.find((c) => String(c.id) === sp.class)?.id ?? null;
  const classIds = selectedClass ? [selectedClass] : classes.map((c) => c.id);

  const search = q ? sql`AND (s.reg_no ILIKE ${`%${q.replace(/\s+/g, "")}%`} OR s.name ILIKE ${`%${q}%`})` : sql``;
  const today = todayIn();
  const { rows } = await getDb().execute<{ id: number; reg_no: string; name: string; dept: string; semester: number; batch: string | null; contacts: number; consented: number; left: boolean; status: string }>(sql`
    SELECT s.id, s.reg_no, s.name, d.code AS dept, cg.semester, s.status, (m.left_on IS NOT NULL) AS left,
      (SELECT ba.batch FROM batch_assignment ba WHERE ba.membership_id = m.id AND ba.effective_from <= ${today} ORDER BY ba.effective_from DESC LIMIT 1) AS batch,
      (SELECT count(*)::int FROM parent_contact pc WHERE pc.student_id = s.id) AS contacts,
      (SELECT count(*)::int FROM parent_contact pc WHERE pc.student_id = s.id AND pc.consent_at IS NOT NULL AND pc.opted_out_at IS NULL) AS consented
    FROM class_membership m
    JOIN student s ON s.id = m.student_id
    JOIN class_group cg ON cg.id = m.class_group_id
    JOIN department d ON d.id = cg.department_id
    WHERE m.class_group_id IN (${sql.join(classIds.map((c) => sql`${c}`), sql`, `)}) ${search}
    ORDER BY d.code, cg.semester, s.reg_no
    LIMIT ${LIMIT + 1}`);
  const truncated = rows.length > LIMIT;
  const shown = rows.slice(0, LIMIT);

  return (
    <>
      <PageHeader title="Students" subtitle={truncated ? `First ${LIMIT} shown — search or pick a class to narrow down` : `${shown.length} students`} />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          <Input name="q" defaultValue={q} placeholder="Register no. or name" className="max-w-xs" />
          <Select name="class" defaultValue={selectedClass ?? ""} className="max-w-48">
            <option value="">All my classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.departmentCode} Sem {c.semester}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Search</button>
        </form>
        {shown.length === 0 ? (
          <Empty>No students match.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Register no.</Th>
                <Th>Name</Th>
                <Th>Class</Th>
                <Th>Batch</Th>
                <Th>Parent numbers</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => (
                <tr key={s.id} className={s.left ? "opacity-50" : ""}>
                  <Td className="font-mono text-xs">{s.reg_no}</Td>
                  <Td>
                    <Link href={`/students/${s.id}`} className="text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                    {s.left && <Badge tone="red">Left</Badge>}
                  </Td>
                  <Td>
                    {s.dept} Sem {s.semester}
                  </Td>
                  <Td>{s.batch ?? "—"}</Td>
                  <Td>
                    {s.contacts === 0 ? (
                      <Badge tone="red">None</Badge>
                    ) : s.consented < s.contacts ? (
                      <Badge tone="amber">
                        {s.contacts} · {s.contacts - s.consented} without consent
                      </Badge>
                    ) : (
                      <Badge tone="green">{s.contacts}</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
