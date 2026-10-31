import Link from "next/link";
import { Card, Empty, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { classTeacherClassIds, seesWholeCollege, visibleDepartmentIds } from "@/lib/auth/permissions";
import { formatDateShort } from "@/lib/domain/dates";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses } from "@/server/queries";

export const metadata = { title: "Classes · MEI Attendance" };

export default async function ClassesPage() {
  const me = await requireStaff();
  const term = await getCurrentTerm();
  if (!term) return <NoAccess what="classes (no term set up yet)" />;
  const depts = visibleDepartmentIds(me.actor);
  const ownClasses = [...new Set([...classTeacherClassIds(me.actor), ...me.actor.teachingClassIds])];
  const classes = seesWholeCollege(me.actor)
    ? await listClasses(term.id)
    : depts && depts.length > 0
      ? (await listClasses(term.id)).filter((c) => depts.includes(c.departmentId) || ownClasses.includes(c.id))
      : await listClasses(term.id, { classIds: ownClasses });

  return (
    <>
      <PageHeader title="Classes" subtitle={`${term.kind === "ODD" ? "Odd" : "Even"} semester · ${formatDateShort(term.startsOn)} – ${formatDateShort(term.endsOn)}`} />
      <Card>
        {classes.length === 0 ? (
          <Empty>You are not linked to any class yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Class</Th>
                <Th>Department</Th>
                <Th className="text-right">Students</Th>
                <Th>Class teacher</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {classes.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/classes/${c.id}`} className="font-medium text-blue-700 hover:underline">
                      {c.departmentCode} Sem {c.semester}
                    </Link>
                  </Td>
                  <Td className="text-slate-600">{c.departmentName}</Td>
                  <Td className="text-right tabular-nums">{c.students}</Td>
                  <Td>{c.classTeacher ?? <span className="text-amber-700">Not set</span>}</Td>
                  <Td>
                    <Link href={`/classes/${c.id}/timetable`} className="text-sm text-blue-700 hover:underline">
                      Timetable
                    </Link>
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
