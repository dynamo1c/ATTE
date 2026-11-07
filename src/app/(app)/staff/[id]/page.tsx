import { eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { roleGrant, staff } from "@/db/schema";
import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, NoAccess, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { ROLE_LABEL, SENIOR_ROLES, canManageStaffMember, canViewStaffList, hodDepartmentIds, isAdmin, type Role } from "@/lib/auth/permissions";
import { formatIndianMobile } from "@/lib/domain/phone";
import { requireStaff } from "@/server/current";
import { getCurrentTerm, listClasses, listDepartments, parseId } from "@/server/queries";
import { grantRole, resetStaffPassword, revokeRole, setStaffActive, updateStaff } from "../actions";
import { StaffFields } from "../staff-fields";

export default async function StaffDetailPage(props: PageProps<"/staff/[id]">) {
  const me = await requireStaff();
  const id = parseId((await props.params).id);
  if (!id) notFound();
  if (!canViewStaffList(me.actor)) return <NoAccess what="staff profiles" />;
  const db = getDb();
  const [person] = await db.select().from(staff).where(eq(staff.id, id));
  if (!person) notFound();
  const term = await getCurrentTerm();
  const admin = isAdmin(me.actor);
  const own = hodDepartmentIds(me.actor);
  const { rows: roleRows } = await db.execute<{ role: Role }>(sql`SELECT role::text AS role FROM role_grant WHERE staff_id = ${id}`);
  const canEdit = canManageStaffMember(me.actor, { staffId: id, departmentId: person.departmentId, roles: roleRows.map((r) => r.role) });
  // Roles and places this viewer may hand out: everything for the admin; Faculty / class teacher in their department for an HOD.
  const roleChoices = Object.entries(ROLE_LABEL).filter(([r]) => admin || !SENIOR_ROLES.includes(r as Role) && r !== "ADMIN");
  const [allDepartments, classes, grants, teaching, lastSeen] = await Promise.all([
    listDepartments(),
    term ? listClasses(term.id, { departmentIds: admin ? null : own }) : Promise.resolve([]),
    db.execute<{ id: number; role: keyof typeof ROLE_LABEL; dept: string | null; dept_id: number | null; class_dept: string | null; class_dept_id: number | null; semester: number | null }>(sql`
      SELECT g.id, g.role, d.code AS dept, g.department_id AS dept_id, cd.code AS class_dept, cg.department_id AS class_dept_id, cg.semester
      FROM ${roleGrant} g
      LEFT JOIN department d ON d.id = g.department_id
      LEFT JOIN class_group cg ON cg.id = g.class_group_id
      LEFT JOIN department cd ON cd.id = cg.department_id
      WHERE g.staff_id = ${id} ORDER BY g.role, g.id`),
    db.execute<{ subject: string; component: string; dept: string; semester: number; batch_scope: string }>(sql`
      SELECT c.short_name AS subject, ta.component, d.code AS dept, cg.semester, ta.batch_scope
      FROM teaching_assignment ta
      JOIN course_offering o ON o.id = ta.offering_id
      JOIN course c ON c.id = o.course_id
      JOIN class_group cg ON cg.id = o.class_group_id
      JOIN department d ON d.id = cg.department_id
      WHERE ta.staff_id = ${id} AND cg.term_id = ${term?.id ?? -1}
      ORDER BY d.code, cg.semester, c.short_name`),
    db.execute<{ last_seen: string | null }>(sql`SELECT to_char(max(last_seen_at), 'DD Mon YYYY, HH24:MI') AS last_seen FROM staff_session WHERE staff_id = ${id}`),
  ]);

  const departments = admin ? allDepartments : allDepartments.filter((d) => own.includes(d.id));
  const profileDepartments = canEdit ? departments : allDepartments;

  return (
    <>
      <PageHeader
        title={
          <>
            {person.name} {!person.active && <Badge tone="red">Inactive</Badge>}
          </>
        }
        subtitle={`${formatIndianMobile(person.phone)} · ${person.designation ?? "—"} · Last active: ${lastSeen.rows[0]?.last_seen ?? "never"}`}
        back={{ href: "/staff", label: "Staff" }}
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Profile">
          <ActionForm action={updateStaff} className="space-y-4">
            <input type="hidden" name="id" value={person.id} />
            <fieldset disabled={!canEdit}>
              <StaffFields departments={profileDepartments} values={person} allowNone={admin || !canEdit} />
            </fieldset>
            {canEdit && <SubmitButton>Save profile</SubmitButton>}
          </ActionForm>
        </Card>

        <Card title="Roles">
          {grants.rows.length === 0 ? (
            <Empty>No roles yet — this person can sign in but sees nothing.</Empty>
          ) : (
            <ul className="divide-y divide-slate-100">
              {grants.rows.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{ROLE_LABEL[g.role]}</span>
                    {g.dept && <span className="text-slate-500"> · {g.dept}</span>}
                    {g.class_dept && (
                      <span className="text-slate-500">
                        {" "}
                        · {g.class_dept} Sem {g.semester}
                      </span>
                    )}
                  </span>
                  {canEdit && (admin || (g.role === "FACULTY" && g.dept_id !== null && own.includes(g.dept_id)) || (g.role === "CLASS_TEACHER" && g.class_dept_id !== null && own.includes(g.class_dept_id))) && (
                    <ActionForm action={revokeRole} confirm={`Remove ${ROLE_LABEL[g.role]} role from ${person.name}?`}>
                      <input type="hidden" name="grantId" value={g.id} />
                      <SubmitButton variant="danger" size="sm">
                        Remove
                      </SubmitButton>
                    </ActionForm>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <ActionForm action={grantRole} resetOnSuccess className="mt-4 space-y-3 border-t border-slate-200 pt-4">
              <input type="hidden" name="staffId" value={person.id} />
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Add role" name="role">
                  <Select id="role" name="role" defaultValue="FACULTY">
                    {roleChoices.map(([v, label]) => (
                      <option key={v} value={v}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Department" name="departmentId" hint="For HOD / Faculty">
                  <Select id="departmentId" name="departmentId" defaultValue={person.departmentId ?? ""}>
                    <option value="">—</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.code}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Class" name="classGroupId" hint="For class teacher">
                  <Select id="classGroupId" name="classGroupId" defaultValue="">
                    <option value="">—</option>
                    {classes.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.departmentCode} Sem {c.semester}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton variant="secondary">Add role</SubmitButton>
            </ActionForm>
          )}
        </Card>

        <Card title="Teaches this term">
          {teaching.rows.length === 0 ? (
            <Empty>No subjects assigned.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Class</Th>
                  <Th>Subject</Th>
                  <Th>Part</Th>
                </tr>
              </thead>
              <tbody>
                {teaching.rows.map((t, i) => (
                  <tr key={i}>
                    <Td>
                      {t.dept} Sem {t.semester}
                    </Td>
                    <Td>{t.subject}</Td>
                    <Td>
                      {t.component === "PRACTICAL" ? "Lab" : "Theory"}
                      {t.batch_scope !== "ALL" && ` (${t.batch_scope})`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {canEdit && (
          <Card title="Account">
            <div className="space-y-4">
              <ActionForm action={resetStaffPassword} confirm={`Reset ${person.name}'s password? They will be signed out everywhere.`}>
                <input type="hidden" name="id" value={person.id} />
                <p className="mb-2 text-sm text-slate-600">Creates a new temporary password. They must change it at next sign-in.</p>
                <SubmitButton variant="secondary">Reset password</SubmitButton>
              </ActionForm>
              <ActionForm
                action={setStaffActive}
                confirm={person.active ? `Deactivate ${person.name}? They can no longer sign in. Their past records stay.` : undefined}
                className="border-t border-slate-200 pt-4"
              >
                <input type="hidden" name="id" value={person.id} />
                <input type="hidden" name="active" value={person.active ? "false" : "true"} />
                <p className="mb-2 text-sm text-slate-600">
                  {person.active ? "Deactivate when someone leaves the college. Nothing they recorded is deleted." : "This account is deactivated and cannot sign in."}
                </p>
                <SubmitButton variant={person.active ? "danger" : "secondary"}>{person.active ? "Deactivate account" : "Re-activate account"}</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
