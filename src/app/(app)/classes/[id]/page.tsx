import { sql } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, LinkButton, NoAccess, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { canManageClass, canViewClass } from "@/lib/auth/permissions";
import { todayIn } from "@/lib/domain/dates";
import { allowedComponents } from "@/lib/domain/timetable";
import { coursesNotOffered, listOfferings, teacherOptions } from "@/server/class-data";
import { requireStaff } from "@/server/current";
import { getClass, parseId } from "@/server/queries";
import { addAssignment, addOffering, removeAssignment, removeOffering } from "../actions";

const KIND_LABEL = { INTEGRATED: "Theory + lab", THEORY_ONLY: "Theory only", PRACTICAL_ONLY: "Lab only", SPECIALIZATION: "Specialization" } as const;

export default async function ClassPage(props: PageProps<"/classes/[id]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  const cls = id ? await getClass(id) : null;
  if (!cls) notFound();
  if (!canViewClass(me.actor, cls)) return <NoAccess what="this class" />;
  const canManage = canManageClass(me.actor, cls);
  const today = todayIn();

  const [offerings, teachers, addable, roster] = await Promise.all([
    listOfferings(cls.id),
    canManage ? teacherOptions(cls.departmentId) : Promise.resolve([]),
    canManage ? coursesNotOffered(cls.id, cls.departmentId, cls.semester) : Promise.resolve([]),
    getDb().execute<{ id: number; reg_no: string; name: string; status: string; lateral_entry: boolean; batch: string | null; joined_on: string; left_on: string | null }>(sql`
      SELECT s.id, s.reg_no, s.name, s.status, s.lateral_entry, to_char(m.joined_on, 'DD Mon') AS joined_on, to_char(m.left_on, 'DD Mon') AS left_on,
        (SELECT ba.batch FROM batch_assignment ba WHERE ba.membership_id = m.id AND ba.effective_from <= ${today} ORDER BY ba.effective_from DESC LIMIT 1) AS batch
      FROM class_membership m JOIN student s ON s.id = m.student_id
      WHERE m.class_group_id = ${cls.id}
      ORDER BY s.reg_no`),
  ]);
  const b1 = roster.rows.filter((r) => r.batch === "B1" && !r.left_on).length;
  const b2 = roster.rows.filter((r) => r.batch === "B2" && !r.left_on).length;

  return (
    <>
      <PageHeader
        title={`${cls.departmentCode} Sem ${cls.semester}`}
        subtitle={`${cls.departmentName} · ${roster.rows.filter((r) => !r.left_on).length} students (B1: ${b1}, B2: ${b2})`}
        back={{ href: "/classes", label: "Classes" }}
        actions={
          <>
            <LinkButton href={`/classes/${cls.id}/attendance`} variant="secondary">
              Attendance %
            </LinkButton>
            <LinkButton href={`/classes/${cls.id}/timetable`} variant="secondary">
              Timetable
            </LinkButton>
          </>
        }
      />

      <Card title="Subjects & teachers" className="mb-6">
        {offerings.length === 0 && <Empty>No subjects added to this class yet.</Empty>}
        <div className="divide-y divide-slate-100">
          {offerings.map((o) => (
            <div key={o.id} className="py-3 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-900">{o.shortName}</span>
                  {o.name !== o.shortName && <span className="text-sm text-slate-500"> — {o.name}</span>}
                  <span className="ml-2">
                    <Badge>{KIND_LABEL[o.kind]}</Badge>
                  </span>
                </div>
                {canManage && (
                  <ActionForm action={removeOffering} confirm={`Remove ${o.shortName} from this class?`} hideMessages={false}>
                    <input type="hidden" name="offeringId" value={o.id} />
                    <SubmitButton variant="ghost" size="sm">
                      Remove subject
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
              <ul className="mt-2 flex flex-wrap gap-2">
                {o.assignments.length === 0 && <li className="text-sm text-amber-700">No teacher assigned</li>}
                {o.assignments.map((a) => (
                  <li key={a.id} className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 py-1 pl-2 pr-1 text-sm">
                    <span className="text-slate-500">{a.component === "PRACTICAL" ? "Lab" : "Theory"}{a.batchScope !== "ALL" && ` ${a.batchScope}`}:</span>
                    <span>{a.staffName}</span>
                    {canManage && (
                      <ActionForm action={removeAssignment} confirm={`Remove ${a.staffName} from ${o.shortName}?`}>
                        <input type="hidden" name="assignmentId" value={a.id} />
                        <button type="submit" className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${a.staffName}`}>
                          ×
                        </button>
                      </ActionForm>
                    )}
                  </li>
                ))}
              </ul>
              {canManage && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-blue-700">Assign teacher</summary>
                  <ActionForm action={addAssignment} resetOnSuccess className="mt-2 grid gap-2 sm:grid-cols-4 sm:items-end">
                    <input type="hidden" name="offeringId" value={o.id} />
                    <Field label="Part" name="component" htmlFor={`component-${o.id}`}>
                      <Select id={`component-${o.id}`} name="component">
                        {allowedComponents(o.kind).map((c) => (
                          <option key={c} value={c}>
                            {c === "PRACTICAL" ? "Lab" : "Theory"}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Batch" name="batchScope" htmlFor={`batch-${o.id}`}>
                      <Select id={`batch-${o.id}`} name="batchScope">
                        <option value="ALL">Both batches</option>
                        <option value="B1">B1 only</option>
                        <option value="B2">B2 only</option>
                      </Select>
                    </Field>
                    <Field label="Teacher" name="staffId" htmlFor={`staff-${o.id}`}>
                      <Select id={`staff-${o.id}`} name="staffId">
                        {teachers.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} {t.dept ? `(${t.dept})` : "(common)"}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <SubmitButton variant="secondary">Assign</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </div>
          ))}
        </div>
        {canManage && addable.length > 0 && (
          <ActionForm action={addOffering} className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4">
            <input type="hidden" name="classId" value={cls.id} />
            <Field label="Add a subject to this class" name="courseId">
              <Select id="courseId" name="courseId">
                {addable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.shortName} — {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton variant="secondary">Add subject</SubmitButton>
          </ActionForm>
        )}
      </Card>

      <Card title="Students">
        {roster.rows.length === 0 ? (
          <Empty>No students in this class yet.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Register no.</Th>
                <Th>Name</Th>
                <Th>Batch</Th>
                <Th>Notes</Th>
              </tr>
            </thead>
            <tbody>
              {roster.rows.map((s) => (
                <tr key={s.id} className={s.left_on ? "opacity-50" : ""}>
                  <Td className="font-mono text-xs">{s.reg_no}</Td>
                  <Td>
                    <Link href={`/students/${s.id}`} className="text-blue-700 hover:underline">
                      {s.name}
                    </Link>
                  </Td>
                  <Td>{s.batch ?? "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {s.lateral_entry && <Badge tone="blue">Lateral entry</Badge>}
                      {s.left_on && <Badge tone="red">Left {s.left_on}</Badge>}
                      {s.status !== "ACTIVE" && !s.left_on && <Badge tone="amber">{s.status.toLowerCase()}</Badge>}
                    </div>
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
