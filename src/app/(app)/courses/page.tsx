import { and, asc, eq, inArray, type SQL } from "drizzle-orm";
import Link from "next/link";
import { getDb } from "@/db/client";
import { assessmentScheme, course, department } from "@/db/schema";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, NoAccess, PageHeader, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { canManageDepartment, visibleDepartmentIds } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listDepartments } from "@/server/queries";
import { createCourse } from "./actions";
import { COURSE_KIND_LABEL, CourseFields } from "./course-fields";

export const metadata = { title: "Subjects · MEI Attendance" };

export default async function CoursesPage(props: PageProps<"/courses">) {
  const me = await requireStaff();
  const visible = visibleDepartmentIds(me.actor);
  if (visible && visible.length === 0) return <NoAccess what="subjects" />;
  const sp = await props.searchParams;
  const allDepts = await listDepartments();
  const departments = visible ? allDepts.filter((d) => visible.includes(d.id)) : allDepts;
  const dept = departments.find((d) => String(d.id) === sp.dept)?.id ?? (departments.length === 1 ? departments[0].id : null);
  const sem = typeof sp.sem === "string" && /^[1-6]$/.test(sp.sem) ? Number(sp.sem) : null;

  const conds: SQL[] = [inArray(course.departmentId, departments.map((d) => d.id))];
  if (dept) conds.push(eq(course.departmentId, dept));
  if (sem) conds.push(eq(course.semester, sem));
  const db = getDb();
  const [rows, schemes] = await Promise.all([
    db
      .select({ id: course.id, code: course.code, shortName: course.shortName, name: course.name, kind: course.kind, semester: course.semester, active: course.active, dept: department.code })
      .from(course)
      .innerJoin(department, eq(department.id, course.departmentId))
      .where(and(...conds))
      .orderBy(asc(department.code), asc(course.semester), asc(course.code)),
    db.select({ id: assessmentScheme.id, name: assessmentScheme.name }).from(assessmentScheme).orderBy(asc(assessmentScheme.name)),
  ]);
  const canAdd = departments.some((d) => canManageDepartment(me.actor, d.id));

  return (
    <>
      <PageHeader title="Subjects" subtitle="The syllabus catalogue. Give a subject to a class from that class's page." />
      <Card>
        <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
          {departments.length > 1 && (
            <Select name="dept" defaultValue={dept ?? ""} className="max-w-60">
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} — {d.name}
                </option>
              ))}
            </Select>
          )}
          <Select name="sem" defaultValue={sem ?? ""} className="max-w-36">
            <option value="">All semesters</option>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                Sem {n}
              </option>
            ))}
          </Select>
          <button className={buttonClass("secondary")}>Filter</button>
        </form>
        {rows.length === 0 ? (
          <Empty>No subjects match.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Code</Th>
                <Th>Subject</Th>
                <Th>Dept</Th>
                <Th>Sem</Th>
                <Th>Type</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={c.active ? "" : "opacity-50"}>
                  <Td className="font-mono text-xs">{c.code}</Td>
                  <Td>
                    <Link href={`/courses/${c.id}`} className="font-medium text-blue-700 hover:underline">
                      {c.shortName}
                    </Link>
                    {c.name !== c.shortName && <span className="text-slate-500"> — {c.name}</span>}
                    {!c.active && <Badge tone="red">Inactive</Badge>}
                  </Td>
                  <Td>{c.dept}</Td>
                  <Td>{c.semester}</Td>
                  <Td className="text-slate-600">{COURSE_KIND_LABEL[c.kind]}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      {canAdd && (
        <Card title="Add a subject" className="mt-6 max-w-3xl">
          <ActionForm action={createCourse} resetOnSuccess className="space-y-4">
            <CourseFields departments={departments} schemes={schemes} />
            <SubmitButton>Add subject</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
