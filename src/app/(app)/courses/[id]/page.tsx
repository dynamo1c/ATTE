import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { assessmentScheme, course, schemeComponent } from "@/db/schema";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, NoAccess, PageHeader, Table, Td, Th } from "@/components/ui";
import { canManageDepartment, canViewDepartment, visibleDepartmentIds } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listDepartments, parseId } from "@/server/queries";
import { updateCourse } from "../actions";
import { CourseFields } from "../course-fields";

export default async function CoursePage(props: PageProps<"/courses/[id]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  if (!id) notFound();
  const db = getDb();
  const [c] = await db.select().from(course).where(eq(course.id, id));
  if (!c) notFound();
  if (!canViewDepartment(me.actor, c.departmentId)) return <NoAccess what="this subject" />;
  const canEdit = canManageDepartment(me.actor, c.departmentId);
  const visible = visibleDepartmentIds(me.actor);
  const [allDepts, schemes, components] = await Promise.all([
    listDepartments(),
    db.select({ id: assessmentScheme.id, name: assessmentScheme.name }).from(assessmentScheme).orderBy(asc(assessmentScheme.name)),
    db.select().from(schemeComponent).where(eq(schemeComponent.schemeId, c.schemeId)).orderBy(asc(schemeComponent.ordinal)),
  ]);
  const departments = visible ? allDepts.filter((d) => visible.includes(d.id)) : allDepts;

  return (
    <>
      <PageHeader title={c.shortName} subtitle={c.name} back={{ href: "/courses", label: "Subjects" }} />
      <div className="grid gap-6 xl:grid-cols-[2fr_1fr]">
        <Card title="Details">
          <ActionForm action={updateCourse} className="space-y-4">
            <input type="hidden" name="id" value={c.id} />
            <fieldset disabled={!canEdit} className="space-y-4">
              <CourseFields departments={departments} schemes={schemes} values={c} />
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="active" defaultChecked={c.active} className="size-4" /> Active (shown when adding subjects to classes)
              </label>
            </fieldset>
            {canEdit && <SubmitButton>Save</SubmitButton>}
          </ActionForm>
        </Card>
        <Card title="Assessments in its marks scheme">
          <Table>
            <thead>
              <tr>
                <Th>Assessment</Th>
                <Th className="text-right">Max</Th>
              </tr>
            </thead>
            <tbody>
              {components.map((sc) => (
                <tr key={sc.id}>
                  <Td>
                    {sc.label} {sc.isFinal && <span className="text-xs text-slate-500">(final)</span>}
                  </Td>
                  <Td className="text-right tabular-nums">{sc.maxMarks}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <p className="mt-2 text-xs text-slate-500">Max marks and the internal total formula are placeholders until the college confirms them.</p>
        </Card>
      </div>
    </>
  );
}
