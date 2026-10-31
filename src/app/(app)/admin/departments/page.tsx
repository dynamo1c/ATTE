import { ActionForm, Field, SubmitButton } from "@/components/action-form";
import { Badge, Card, Input, NoAccess, PageHeader } from "@/components/ui";
import { isAdmin } from "@/lib/auth/permissions";
import { requireStaff } from "@/server/current";
import { listDepartments } from "@/server/queries";
import { saveDepartment } from "./actions";

export const metadata = { title: "Departments · MEI Attendance" };

export default async function DepartmentsPage() {
  const me = await requireStaff();
  if (!isAdmin(me.actor)) return <NoAccess what="departments" />;
  const departments = await listDepartments();
  return (
    <>
      <PageHeader title="Departments" subtitle="Codes match register numbers (e.g. CS in 204CS25012) and cannot be changed here." />
      <div className="grid gap-4 md:grid-cols-2">
        {departments.map((d) => (
          <Card
            key={d.id}
            title={
              <>
                <span className="font-mono">{d.code}</span> {!d.active && <Badge tone="red">Inactive</Badge>}
              </>
            }
          >
            <ActionForm action={saveDepartment} className="space-y-3">
              <input type="hidden" name="id" value={d.id} />
              <Field label="Name" name="name" htmlFor={`name-${d.id}`}>
                <Input id={`name-${d.id}`} name="name" defaultValue={d.name} />
              </Field>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="active" defaultChecked={d.active} className="size-4" /> Active
              </label>
              <SubmitButton size="sm" variant="secondary">
                Save
              </SubmitButton>
            </ActionForm>
          </Card>
        ))}
      </div>
    </>
  );
}
